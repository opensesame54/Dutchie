import { allocate } from './allocate';

/**
 * Balance calculation.
 *
 * Everything here is a pure function over plain data so it can be tested
 * exhaustively without a database. The ledger invariant that must hold after
 * every operation: net balances across all participants sum to exactly zero.
 * Money is neither created nor destroyed by splitting it.
 */

export interface LedgerExpense {
  id: string;
  currency: string;
  payers: { userId: string; amountMinor: number }[];
  splits: { userId: string; owedAmountMinor: number }[];
}

export interface LedgerSettlement {
  id: string;
  currency: string;
  fromUserId: string;
  toUserId: string;
  amountMinor: number;
}

export interface Ledger {
  expenses: LedgerExpense[];
  settlements: LedgerSettlement[];
}

/** Positive = this user is owed money. Negative = this user owes money. */
export type NetBalances = Map<string, number>;

/**
 * Net position per user, for a single currency.
 *
 * Callers must partition a mixed-currency ledger by currency first — adding
 * yen to euros silently produces nonsense, so this throws instead.
 */
export function computeNetBalances(ledger: Ledger, currency: string): NetBalances {
  const net: NetBalances = new Map();
  const bump = (userId: string, delta: number) => {
    net.set(userId, (net.get(userId) ?? 0) + delta);
  };

  for (const expense of ledger.expenses) {
    assertCurrency(expense.currency, currency, `expense ${expense.id}`);

    const paid = expense.payers.reduce((a, p) => a + p.amountMinor, 0);
    const owed = expense.splits.reduce((a, s) => a + s.owedAmountMinor, 0);
    if (paid !== owed) {
      throw new Error(
        `Expense ${expense.id} is unbalanced: payers total ${paid}, splits total ${owed}`,
      );
    }

    for (const p of expense.payers) bump(p.userId, p.amountMinor);
    for (const s of expense.splits) bump(s.userId, -s.owedAmountMinor);
  }

  for (const settlement of ledger.settlements) {
    assertCurrency(settlement.currency, currency, `settlement ${settlement.id}`);
    if (settlement.fromUserId === settlement.toUserId) {
      throw new Error(`Settlement ${settlement.id} pays from a user to themselves`);
    }
    // Paying down a debt moves the payer toward zero from below.
    bump(settlement.fromUserId, settlement.amountMinor);
    bump(settlement.toUserId, -settlement.amountMinor);
  }

  // Drop users who net to exactly zero — they have nothing outstanding and
  // showing them as "settled up" is the UI's job, not the ledger's.
  for (const [userId, amount] of net) {
    if (amount === 0) net.delete(userId);
  }

  return net;
}

export interface PairwiseDebt {
  fromUserId: string;
  toUserId: string;
  amountMinor: number;
}

/**
 * Who owes whom, tracked pair by pair, WITHOUT simplification.
 *
 * This is what a friend-to-friend balance screen shows: "you owe Priya $12"
 * reflects actual shared expenses, not a rerouted payment through someone the
 * user has never met. Simplification is a separate, opt-in step.
 */
export function computePairwiseDebts(ledger: Ledger, currency: string): PairwiseDebt[] {
  // Keyed "a|b" with a < b lexicographically; value is what `a` owes `b`
  // (negative means b owes a). Using an ordered key keeps each pair in one slot.
  const pairs = new Map<string, number>();

  const bumpPair = (debtor: string, creditor: string, amount: number) => {
    if (debtor === creditor || amount === 0) return;
    const [a, b] = debtor < creditor ? [debtor, creditor] : [creditor, debtor];
    const signed = debtor === a ? amount : -amount;
    pairs.set(`${a}|${b}`, (pairs.get(`${a}|${b}`) ?? 0) + signed);
  };

  for (const expense of ledger.expenses) {
    assertCurrency(expense.currency, currency, `expense ${expense.id}`);

    const payers = expense.payers.filter((p) => p.amountMinor !== 0);
    if (payers.length === 0) continue;

    for (const split of expense.splits) {
      if (split.owedAmountMinor === 0) continue;

      // Spread what this person owes across the payers in proportion to what
      // each actually put in. Allocating (rather than dividing) keeps the
      // per-payer pieces summing to the exact debt even with odd cents.
      const shares = allocate(
        split.owedAmountMinor,
        payers.map((p) => p.amountMinor),
      );
      payers.forEach((payer, i) => {
        // The portion a payer owes to themselves cancels out and is dropped.
        bumpPair(split.userId, payer.userId, shares[i]);
      });
    }
  }

  for (const settlement of ledger.settlements) {
    assertCurrency(settlement.currency, currency, `settlement ${settlement.id}`);
    // A payment from A to B reduces what A owes B.
    bumpPair(settlement.fromUserId, settlement.toUserId, -settlement.amountMinor);
  }

  const debts: PairwiseDebt[] = [];
  for (const [key, amount] of pairs) {
    if (amount === 0) continue;
    const [a, b] = key.split('|');
    debts.push(
      amount > 0
        ? { fromUserId: a, toUserId: b, amountMinor: amount }
        : { fromUserId: b, toUserId: a, amountMinor: -amount },
    );
  }

  // Deterministic ordering so API responses are stable between calls.
  debts.sort(
    (x, y) =>
      x.fromUserId.localeCompare(y.fromUserId) || x.toUserId.localeCompare(y.toUserId),
  );
  return debts;
}

function assertCurrency(actual: string, expected: string, what: string): void {
  if (actual !== expected) {
    throw new Error(
      `Currency mismatch on ${what}: ledger is ${expected} but found ${actual}. ` +
        'Partition the ledger by currency before computing balances.',
    );
  }
}
