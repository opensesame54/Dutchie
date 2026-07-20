import { simplifyDebts, applyTransfers, type SimplifiedTransfer } from './simplify';
import type { NetBalances } from './balances';

const net = (entries: Record<string, number>): NetBalances =>
  new Map(Object.entries(entries));

/** Everyone must end at zero — the only non-negotiable property. */
function expectFullySettled(input: NetBalances, transfers: SimplifiedTransfer[]) {
  const after = applyTransfers(input, transfers);
  for (const [userId, amount] of after) {
    expect({ userId, amount }).toEqual({ userId, amount: 0 });
  }
}

describe('simplifyDebts', () => {
  it('settles a simple two-person debt in one payment', () => {
    const balances = net({ alice: 1000, bob: -1000 });
    const transfers = simplifyDebts(balances);
    expect(transfers).toEqual([
      { fromUserId: 'bob', toUserId: 'alice', amountMinor: 1000 },
    ]);
    expectFullySettled(balances, transfers);
  });

  it('collapses a three-way circular debt', () => {
    // A owes B 10, B owes C 10, C owes A 10 -> everyone is already square.
    const balances = net({ alice: 0, bob: 0, carol: 0 });
    expect(simplifyDebts(balances)).toEqual([]);
  });

  it('reroutes a chain into a direct payment', () => {
    // A owes B $10 and B owes C $10. Net: A -10, B 0, C +10.
    // The whole point of simplification: A pays C directly, B is untouched.
    const balances = net({ alice: -1000, bob: 0, carol: 1000 });
    const transfers = simplifyDebts(balances);
    expect(transfers).toEqual([
      { fromUserId: 'alice', toUserId: 'carol', amountMinor: 1000 },
    ]);
    expectFullySettled(balances, transfers);
  });

  it('never needs more than n-1 payments', () => {
    const balances = net({ a: -500, b: -300, c: -200, d: 400, e: 600 });
    const transfers = simplifyDebts(balances);
    expect(transfers.length).toBeLessThanOrEqual(balances.size - 1);
    expectFullySettled(balances, transfers);
  });

  it('prefers exact matches over splitting a payment', () => {
    // Bob owes exactly what Dave is owed; that should be one clean payment
    // rather than Bob's debt being carved up across two creditors.
    const balances = net({ alice: 1000, bob: -700, carol: -1000, dave: 700 });
    const transfers = simplifyDebts(balances);
    expect(transfers).toContainEqual({
      fromUserId: 'bob',
      toUserId: 'dave',
      amountMinor: 700,
    });
    expect(transfers).toHaveLength(2);
    expectFullySettled(balances, transfers);
  });

  it('handles one debtor owing several creditors', () => {
    const balances = net({ alice: -1000, bob: 600, carol: 400 });
    const transfers = simplifyDebts(balances);
    expect(transfers).toHaveLength(2);
    expect(transfers.every((t) => t.fromUserId === 'alice')).toBe(true);
    expectFullySettled(balances, transfers);
  });

  it('handles several debtors owing one creditor', () => {
    const balances = net({ alice: 1000, bob: -600, carol: -400 });
    const transfers = simplifyDebts(balances);
    expect(transfers).toHaveLength(2);
    expect(transfers.every((t) => t.toUserId === 'alice')).toBe(true);
    expectFullySettled(balances, transfers);
  });

  it('ignores users who are already settled', () => {
    const balances = net({ alice: 1000, bob: -1000, carol: 0 });
    const transfers = simplifyDebts(balances);
    expect(transfers.some((t) => t.fromUserId === 'carol' || t.toUserId === 'carol')).toBe(
      false,
    );
  });

  it('returns nothing when everyone is settled', () => {
    expect(simplifyDebts(net({}))).toEqual([]);
    expect(simplifyDebts(net({ alice: 0, bob: 0 }))).toEqual([]);
  });

  it('never produces a payment of zero', () => {
    const balances = net({ a: -1, b: -999, c: 1000 });
    const transfers = simplifyDebts(balances);
    expect(transfers.every((t) => t.amountMinor > 0)).toBe(true);
  });

  it('never produces a self-payment', () => {
    const balances = net({ a: -500, b: 200, c: 300 });
    const transfers = simplifyDebts(balances);
    expect(transfers.every((t) => t.fromUserId !== t.toUserId)).toBe(true);
  });

  it('refuses to simplify a corrupt ledger', () => {
    // If balances do not sum to zero something upstream is broken. Producing
    // payment instructions from it would hide a real accounting bug.
    expect(() => simplifyDebts(net({ alice: 1000, bob: -900 }))).toThrow(
      /sum to 100, expected 0/,
    );
  });

  it('is deterministic', () => {
    const balances = net({ a: -500, b: -500, c: 500, d: 500 });
    const first = simplifyDebts(balances);
    for (let i = 0; i < 20; i += 1) {
      expect(simplifyDebts(balances)).toEqual(first);
    }
  });

  it('does not mutate the balances it is given', () => {
    const balances = net({ alice: 1000, bob: -1000 });
    simplifyDebts(balances);
    expect(Object.fromEntries(balances)).toEqual({ alice: 1000, bob: -1000 });
  });

  // Randomised: the invariants must hold for any zero-sum ledger.
  it('fully settles randomised ledgers within n-1 payments', () => {
    for (let trial = 0; trial < 1000; trial += 1) {
      const count = 2 + Math.floor(Math.random() * 10);
      const amounts: number[] = [];
      for (let i = 0; i < count - 1; i += 1) {
        amounts.push(Math.floor(Math.random() * 200_000) - 100_000);
      }
      // Last participant absorbs the remainder so the ledger sums to zero.
      amounts.push(-amounts.reduce((a, b) => a + b, 0));

      const balances = net(
        Object.fromEntries(amounts.map((amount, i) => [`user${i}`, amount])),
      );
      const transfers = simplifyDebts(balances);

      expectFullySettled(balances, transfers);
      expect(transfers.length).toBeLessThanOrEqual(count - 1);
      expect(transfers.every((t) => t.amountMinor > 0)).toBe(true);
      expect(transfers.every((t) => t.fromUserId !== t.toUserId)).toBe(true);
    }
  });

  it('is never worse than the unsimplified pairwise count on a full mesh', () => {
    // Everyone owes everyone a little: pairwise would be 6 payments for 4
    // people, simplification must beat that.
    const balances = net({ a: -300, b: -100, c: 150, d: 250 });
    const transfers = simplifyDebts(balances);
    expect(transfers.length).toBeLessThan(6);
    expectFullySettled(balances, transfers);
  });
});
