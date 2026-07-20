import type { NetBalances, PairwiseDebt } from './balances';

/**
 * Debt simplification: collapse a tangled web of IOUs into few payments.
 *
 * A NOTE ON OPTIMALITY, because it is easy to over-claim here:
 *
 * Finding the true minimum number of transactions is NP-hard — it reduces to
 * multi-way set partitioning (each zero-sum subset of people can settle
 * internally, and finding the most such subsets is the hard part). What this
 * implements instead is:
 *
 *   1. A pre-pass that cancels exact matches — any debtor whose balance is the
 *      exact negation of a creditor's settles in one payment. This is where
 *      most real-world wins come from and it is what makes the classic
 *      A->B->C->A cycle collapse cleanly.
 *   2. Greedy largest-debtor / largest-creditor matching for the remainder.
 *
 * The result is guaranteed to be correct (every net balance reaches zero) and
 * to use at most n-1 payments, which is a hard upper bound for n people. It is
 * not guaranteed minimal in adversarial cases. That trade is deliberate: a
 * settle-up screen must render in milliseconds, and being one payment above
 * optimal in a rare case is invisible next to being exactly right about money.
 */

export interface SimplifiedTransfer {
  fromUserId: string;
  toUserId: string;
  amountMinor: number;
}

export function simplifyDebts(net: NetBalances): SimplifiedTransfer[] {
  const debtors: { userId: string; amount: number }[] = [];
  const creditors: { userId: string; amount: number }[] = [];

  let sum = 0;
  for (const [userId, amount] of net) {
    sum += amount;
    if (amount < 0) debtors.push({ userId, amount: -amount });
    else if (amount > 0) creditors.push({ userId, amount });
  }

  // If this fails the ledger itself is corrupt; simplifying it would launder
  // the error into plausible-looking payment instructions.
  if (sum !== 0) {
    throw new Error(`Cannot simplify: net balances sum to ${sum}, expected 0`);
  }

  const transfers: SimplifiedTransfer[] = [];

  // Pass 1 — exact matches. Sorting first keeps the pairing deterministic when
  // several people happen to owe the same amount.
  sortLedger(debtors);
  sortLedger(creditors);

  for (const debtor of debtors) {
    if (debtor.amount === 0) continue;
    const match = creditors.find((c) => c.amount === debtor.amount);
    if (!match) continue;
    transfers.push({
      fromUserId: debtor.userId,
      toUserId: match.userId,
      amountMinor: debtor.amount,
    });
    debtor.amount = 0;
    match.amount = 0;
  }

  // Pass 2 — greedy on whatever is left.
  const remainingDebtors = debtors.filter((d) => d.amount > 0);
  const remainingCreditors = creditors.filter((c) => c.amount > 0);
  sortLedger(remainingDebtors);
  sortLedger(remainingCreditors);

  let i = 0;
  let j = 0;
  while (i < remainingDebtors.length && j < remainingCreditors.length) {
    const debtor = remainingDebtors[i];
    const creditor = remainingCreditors[j];
    const amount = Math.min(debtor.amount, creditor.amount);

    transfers.push({
      fromUserId: debtor.userId,
      toUserId: creditor.userId,
      amountMinor: amount,
    });

    debtor.amount -= amount;
    creditor.amount -= amount;
    if (debtor.amount === 0) i += 1;
    if (creditor.amount === 0) j += 1;
  }

  transfers.sort(
    (a, b) =>
      b.amountMinor - a.amountMinor ||
      a.fromUserId.localeCompare(b.fromUserId) ||
      a.toUserId.localeCompare(b.toUserId),
  );
  return transfers;
}

/** Largest first, then by user id so equal amounts pair deterministically. */
function sortLedger(entries: { userId: string; amount: number }[]): void {
  entries.sort((a, b) => b.amount - a.amount || a.userId.localeCompare(b.userId));
}

/**
 * Apply a set of transfers to net balances, for verification. Used by the tests
 * to assert that a simplification actually settles everyone.
 */
export function applyTransfers(
  net: NetBalances,
  transfers: SimplifiedTransfer[],
): NetBalances {
  const result = new Map(net);
  for (const t of transfers) {
    result.set(t.fromUserId, (result.get(t.fromUserId) ?? 0) + t.amountMinor);
    result.set(t.toUserId, (result.get(t.toUserId) ?? 0) - t.amountMinor);
  }
  return result;
}

/** Total number of payments the unsimplified pairwise view would require. */
export function countPairwisePayments(debts: PairwiseDebt[]): number {
  return debts.filter((d) => d.amountMinor !== 0).length;
}
