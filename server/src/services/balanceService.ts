import { prisma } from '../db';
import {
  computeNetBalances,
  computePairwiseDebts,
  type Ledger,
  type PairwiseDebt,
} from '../core/balances';
import { simplifyDebts, type SimplifiedTransfer } from '../core/simplify';

/**
 * Bridges the database to the pure balance functions in src/core.
 *
 * Everything is partitioned by currency before it reaches the calculators —
 * a group can hold expenses in several currencies and summing them without
 * conversion would produce a confidently wrong number.
 */

export interface GroupBalances {
  balancesByCurrency: Record<string, Record<string, number>>;
  debtsByCurrency: Record<string, PairwiseDebt[]>;
  simplifiedByCurrency: Record<string, SimplifiedTransfer[]>;
}

async function loadGroupLedgers(groupId: string): Promise<Map<string, Ledger>> {
  const [expenses, settlements] = await Promise.all([
    prisma.expense.findMany({
      where: { groupId, deletedAt: null },
      include: { payers: true, splits: true },
    }),
    prisma.settlement.findMany({ where: { groupId, deletedAt: null } }),
  ]);

  const ledgers = new Map<string, Ledger>();
  const ledgerFor = (currency: string): Ledger => {
    let ledger = ledgers.get(currency);
    if (!ledger) {
      ledger = { expenses: [], settlements: [] };
      ledgers.set(currency, ledger);
    }
    return ledger;
  };

  for (const e of expenses) {
    ledgerFor(e.currency).expenses.push({
      id: e.id,
      currency: e.currency,
      payers: e.payers.map((p) => ({ userId: p.userId, amountMinor: p.amountMinor })),
      splits: e.splits.map((s) => ({ userId: s.userId, owedAmountMinor: s.owedAmountMinor })),
    });
  }

  for (const s of settlements) {
    ledgerFor(s.currency).settlements.push({
      id: s.id,
      currency: s.currency,
      fromUserId: s.fromUserId,
      toUserId: s.toUserId,
      amountMinor: s.amountMinor,
    });
  }

  return ledgers;
}

export async function computeGroupBalances(groupId: string): Promise<GroupBalances> {
  const ledgers = await loadGroupLedgers(groupId);

  const balancesByCurrency: Record<string, Record<string, number>> = {};
  const debtsByCurrency: Record<string, PairwiseDebt[]> = {};
  const simplifiedByCurrency: Record<string, SimplifiedTransfer[]> = {};

  for (const [currency, ledger] of ledgers) {
    const net = computeNetBalances(ledger, currency);
    balancesByCurrency[currency] = Object.fromEntries(net);
    debtsByCurrency[currency] = computePairwiseDebts(ledger, currency);
    simplifiedByCurrency[currency] = simplifyDebts(net);
  }

  return { balancesByCurrency, debtsByCurrency, simplifiedByCurrency };
}

/**
 * Balances between one user and everyone they share expenses with, across all
 * groups plus direct expenses. This is what the friends list and the "you owe /
 * you are owed" summary render.
 */
export async function computeUserBalances(userId: string): Promise<{
  perFriend: Record<string, Record<string, number>>;
  totalsByCurrency: Record<string, { owed: number; owing: number; net: number }>;
}> {
  const [expenses, settlements] = await Promise.all([
    prisma.expense.findMany({
      where: {
        deletedAt: null,
        OR: [
          { splits: { some: { userId } } },
          { payers: { some: { userId } } },
        ],
      },
      include: { payers: true, splits: true },
    }),
    prisma.settlement.findMany({
      where: { deletedAt: null, OR: [{ fromUserId: userId }, { toUserId: userId }] },
    }),
  ]);

  const ledgers = new Map<string, Ledger>();
  const ledgerFor = (currency: string): Ledger => {
    let ledger = ledgers.get(currency);
    if (!ledger) {
      ledger = { expenses: [], settlements: [] };
      ledgers.set(currency, ledger);
    }
    return ledger;
  };

  for (const e of expenses) {
    ledgerFor(e.currency).expenses.push({
      id: e.id,
      currency: e.currency,
      payers: e.payers.map((p) => ({ userId: p.userId, amountMinor: p.amountMinor })),
      splits: e.splits.map((s) => ({ userId: s.userId, owedAmountMinor: s.owedAmountMinor })),
    });
  }
  for (const s of settlements) {
    ledgerFor(s.currency).settlements.push({
      id: s.id,
      currency: s.currency,
      fromUserId: s.fromUserId,
      toUserId: s.toUserId,
      amountMinor: s.amountMinor,
    });
  }

  // perFriend[friendId][currency] — positive means the friend owes this user.
  const perFriend: Record<string, Record<string, number>> = {};
  const totalsByCurrency: Record<string, { owed: number; owing: number; net: number }> = {};

  for (const [currency, ledger] of ledgers) {
    // The pairwise view is the right one here: a friend balance should reflect
    // what the two people actually shared, not a simplified reroute.
    for (const debt of computePairwiseDebts(ledger, currency)) {
      if (debt.fromUserId !== userId && debt.toUserId !== userId) continue;

      const friendId = debt.fromUserId === userId ? debt.toUserId : debt.fromUserId;
      const signed = debt.toUserId === userId ? debt.amountMinor : -debt.amountMinor;

      perFriend[friendId] ??= {};
      perFriend[friendId][currency] = (perFriend[friendId][currency] ?? 0) + signed;
    }
  }

  for (const currencies of Object.values(perFriend)) {
    for (const [currency, amount] of Object.entries(currencies)) {
      totalsByCurrency[currency] ??= { owed: 0, owing: 0, net: 0 };
      if (amount > 0) totalsByCurrency[currency].owed += amount;
      else totalsByCurrency[currency].owing += -amount;
      totalsByCurrency[currency].net += amount;
    }
  }

  return { perFriend, totalsByCurrency };
}
