import { computeNetBalances, computePairwiseDebts, type Ledger } from './balances';
import { computeSplits } from './splits';

/** Build an expense with an equal split, the common case in these tests. */
function equalExpense(
  id: string,
  amountMinor: number,
  paidBy: string,
  participants: string[],
  currency = 'USD',
) {
  return {
    id,
    currency,
    payers: [{ userId: paidBy, amountMinor }],
    splits: computeSplits(amountMinor, 'EQUAL', participants.map((userId) => ({ userId }))).map(
      (s) => ({ userId: s.userId, owedAmountMinor: s.owedAmountMinor }),
    ),
  };
}

const netOf = (ledger: Ledger, currency = 'USD') =>
  Object.fromEntries(computeNetBalances(ledger, currency));

describe('computeNetBalances', () => {
  it('credits the payer and debits the participants', () => {
    const ledger: Ledger = {
      expenses: [equalExpense('e1', 3000, 'alice', ['alice', 'bob', 'carol'])],
      settlements: [],
    };
    expect(netOf(ledger)).toEqual({ alice: 2000, bob: -1000, carol: -1000 });
  });

  it('always sums to zero', () => {
    const ledger: Ledger = {
      expenses: [
        equalExpense('e1', 1000, 'alice', ['alice', 'bob', 'carol']),
        equalExpense('e2', 777, 'bob', ['alice', 'bob']),
        equalExpense('e3', 45_231, 'carol', ['alice', 'bob', 'carol']),
      ],
      settlements: [],
    };
    const total = [...computeNetBalances(ledger, 'USD').values()].reduce((a, b) => a + b, 0);
    expect(total).toBe(0);
  });

  it('omits users who are fully settled', () => {
    const ledger: Ledger = {
      expenses: [equalExpense('e1', 1000, 'alice', ['alice', 'bob'])],
      settlements: [
        { id: 's1', currency: 'USD', fromUserId: 'bob', toUserId: 'alice', amountMinor: 500 },
      ],
    };
    expect(netOf(ledger)).toEqual({});
  });

  it('handles multiple payers on one expense', () => {
    const ledger: Ledger = {
      expenses: [
        {
          id: 'e1',
          currency: 'USD',
          payers: [
            { userId: 'alice', amountMinor: 600 },
            { userId: 'bob', amountMinor: 400 },
          ],
          splits: [
            { userId: 'alice', owedAmountMinor: 500 },
            { userId: 'bob', owedAmountMinor: 500 },
          ],
        },
      ],
      settlements: [],
    };
    expect(netOf(ledger)).toEqual({ alice: 100, bob: -100 });
  });

  it('rejects an expense whose payments and splits disagree', () => {
    const ledger: Ledger = {
      expenses: [
        {
          id: 'bad',
          currency: 'USD',
          payers: [{ userId: 'alice', amountMinor: 1000 }],
          splits: [{ userId: 'bob', owedAmountMinor: 900 }],
        },
      ],
      settlements: [],
    };
    expect(() => computeNetBalances(ledger, 'USD')).toThrow(/unbalanced/);
  });

  it('refuses to mix currencies rather than silently adding them', () => {
    const ledger: Ledger = {
      expenses: [equalExpense('e1', 1000, 'alice', ['alice', 'bob'], 'EUR')],
      settlements: [],
    };
    expect(() => computeNetBalances(ledger, 'USD')).toThrow(/Currency mismatch/);
  });

  it('rejects a self-paying settlement', () => {
    const ledger: Ledger = {
      expenses: [],
      settlements: [
        { id: 's1', currency: 'USD', fromUserId: 'alice', toUserId: 'alice', amountMinor: 100 },
      ],
    };
    expect(() => computeNetBalances(ledger, 'USD')).toThrow(/themselves/);
  });

  // --- Edge cases called out in the brief -------------------------------

  it('keeps a departed member on the hook for expenses they were part of', () => {
    // Carol was in the group for e1, then left before e2. Leaving must not
    // retroactively rewrite the first expense.
    const ledger: Ledger = {
      expenses: [
        equalExpense('e1', 3000, 'alice', ['alice', 'bob', 'carol']),
        equalExpense('e2', 2000, 'alice', ['alice', 'bob']),
      ],
      settlements: [],
    };
    const net = netOf(ledger);
    expect(net.carol).toBe(-1000);
    expect(net.alice).toBe(3000);
    expect(net.bob).toBe(-2000);
  });

  it('reflects an expense edited after a settlement was recorded', () => {
    // Bob settles $10 against a $20 dinner, then the expense is corrected to
    // $30. His overpayment must carry forward, not vanish.
    const corrected: Ledger = {
      expenses: [equalExpense('e1', 3000, 'alice', ['alice', 'bob'])],
      settlements: [
        { id: 's1', currency: 'USD', fromUserId: 'bob', toUserId: 'alice', amountMinor: 1000 },
      ],
    };
    // Bob owes 1500, has paid 1000 -> still owes 500.
    expect(netOf(corrected)).toEqual({ alice: 500, bob: -500 });
  });

  it('handles a settlement that overshoots the debt', () => {
    const ledger: Ledger = {
      expenses: [equalExpense('e1', 1000, 'alice', ['alice', 'bob'])],
      settlements: [
        { id: 's1', currency: 'USD', fromUserId: 'bob', toUserId: 'alice', amountMinor: 800 },
      ],
    };
    // Bob owed 500, paid 800 -> Alice now owes Bob 300.
    expect(netOf(ledger)).toEqual({ alice: -300, bob: 300 });
  });
});

describe('computePairwiseDebts', () => {
  it('reports who owes whom directly', () => {
    const ledger: Ledger = {
      expenses: [equalExpense('e1', 3000, 'alice', ['alice', 'bob', 'carol'])],
      settlements: [],
    };
    expect(computePairwiseDebts(ledger, 'USD')).toEqual([
      { fromUserId: 'bob', toUserId: 'alice', amountMinor: 1000 },
      { fromUserId: 'carol', toUserId: 'alice', amountMinor: 1000 },
    ]);
  });

  it('nets offsetting debts between the same pair', () => {
    const ledger: Ledger = {
      expenses: [
        equalExpense('e1', 1000, 'alice', ['alice', 'bob']),
        equalExpense('e2', 600, 'bob', ['alice', 'bob']),
      ],
      settlements: [],
    };
    // Bob owes 500, Alice owes 300 -> Bob owes 200 net.
    expect(computePairwiseDebts(ledger, 'USD')).toEqual([
      { fromUserId: 'bob', toUserId: 'alice', amountMinor: 200 },
    ]);
  });

  it('does not route a debt through someone uninvolved', () => {
    // Bob owes Alice; Carol owes Dave. These are unrelated pairs and must stay
    // that way in the unsimplified view.
    const ledger: Ledger = {
      expenses: [
        equalExpense('e1', 1000, 'alice', ['alice', 'bob']),
        equalExpense('e2', 1000, 'dave', ['carol', 'dave']),
      ],
      settlements: [],
    };
    expect(computePairwiseDebts(ledger, 'USD')).toEqual([
      { fromUserId: 'bob', toUserId: 'alice', amountMinor: 500 },
      { fromUserId: 'carol', toUserId: 'dave', amountMinor: 500 },
    ]);
  });

  it('spreads a debt across multiple payers without losing cents', () => {
    const ledger: Ledger = {
      expenses: [
        {
          id: 'e1',
          currency: 'USD',
          payers: [
            { userId: 'alice', amountMinor: 667 },
            { userId: 'bob', amountMinor: 334 },
          ],
          splits: [
            { userId: 'alice', owedAmountMinor: 334 },
            { userId: 'bob', owedAmountMinor: 334 },
            { userId: 'carol', owedAmountMinor: 333 },
          ],
        },
      ],
      settlements: [],
    };
    const debts = computePairwiseDebts(ledger, 'USD');
    const carolOwes = debts
      .filter((d) => d.fromUserId === 'carol')
      .reduce((a, d) => a + d.amountMinor, 0);
    expect(carolOwes).toBe(333);
  });

  it('applies settlements against the specific pair', () => {
    const ledger: Ledger = {
      expenses: [equalExpense('e1', 1000, 'alice', ['alice', 'bob'])],
      settlements: [
        { id: 's1', currency: 'USD', fromUserId: 'bob', toUserId: 'alice', amountMinor: 500 },
      ],
    };
    expect(computePairwiseDebts(ledger, 'USD')).toEqual([]);
  });

  it('agrees with net balances in aggregate', () => {
    const ledger: Ledger = {
      expenses: [
        equalExpense('e1', 1000, 'alice', ['alice', 'bob', 'carol']),
        equalExpense('e2', 2500, 'bob', ['alice', 'bob']),
        equalExpense('e3', 731, 'carol', ['alice', 'bob', 'carol']),
      ],
      settlements: [
        { id: 's1', currency: 'USD', fromUserId: 'alice', toUserId: 'bob', amountMinor: 400 },
      ],
    };
    const net = computeNetBalances(ledger, 'USD');
    const debts = computePairwiseDebts(ledger, 'USD');

    // Rolling up the pairwise view must reproduce the net view exactly.
    const rolled = new Map<string, number>();
    for (const d of debts) {
      rolled.set(d.fromUserId, (rolled.get(d.fromUserId) ?? 0) - d.amountMinor);
      rolled.set(d.toUserId, (rolled.get(d.toUserId) ?? 0) + d.amountMinor);
    }
    for (const [userId, amount] of net) {
      expect(rolled.get(userId) ?? 0).toBe(amount);
    }
  });
});
