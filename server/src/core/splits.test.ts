import { computeSplits, validatePayers, SplitValidationError } from './splits';

const sumOwed = (splits: { owedAmountMinor: number }[]) =>
  splits.reduce((a, s) => a + s.owedAmountMinor, 0);

describe('computeSplits — EQUAL', () => {
  it('splits a clean amount evenly', () => {
    const splits = computeSplits(3000, 'EQUAL', [
      { userId: 'a' }, { userId: 'b' }, { userId: 'c' },
    ]);
    expect(splits.map((s) => s.owedAmountMinor)).toEqual([1000, 1000, 1000]);
  });

  it('assigns the odd cent deterministically', () => {
    const splits = computeSplits(1000, 'EQUAL', [
      { userId: 'a' }, { userId: 'b' }, { userId: 'c' },
    ]);
    expect(sumOwed(splits)).toBe(1000);
    expect(splits.map((s) => s.owedAmountMinor)).toEqual([334, 333, 333]);
  });

  it('handles a solo expense', () => {
    const splits = computeSplits(500, 'EQUAL', [{ userId: 'a' }]);
    expect(splits[0].owedAmountMinor).toBe(500);
  });
});

describe('computeSplits — EXACT', () => {
  it('uses the exact amounts given', () => {
    const splits = computeSplits(1000, 'EXACT', [
      { userId: 'a', value: 700 },
      { userId: 'b', value: 300 },
    ]);
    expect(splits.map((s) => s.owedAmountMinor)).toEqual([700, 300]);
  });

  it('rejects amounts that do not add up to the total', () => {
    expect(() =>
      computeSplits(1000, 'EXACT', [
        { userId: 'a', value: 700 },
        { userId: 'b', value: 200 },
      ]),
    ).toThrow(SplitValidationError);
  });

  it('allows a participant to owe zero', () => {
    const splits = computeSplits(1000, 'EXACT', [
      { userId: 'a', value: 1000 },
      { userId: 'b', value: 0 },
    ]);
    expect(splits[1].owedAmountMinor).toBe(0);
  });

  it('rejects negative amounts', () => {
    expect(() =>
      computeSplits(1000, 'EXACT', [
        { userId: 'a', value: 1200 },
        { userId: 'b', value: -200 },
      ]),
    ).toThrow(/negative/);
  });
});

describe('computeSplits — PERCENTAGE', () => {
  it('applies percentages given in basis points', () => {
    const splits = computeSplits(10_000, 'PERCENTAGE', [
      { userId: 'a', value: 2500 },
      { userId: 'b', value: 7500 },
    ]);
    expect(splits.map((s) => s.owedAmountMinor)).toEqual([2500, 7500]);
  });

  it('conserves the total when percentages produce fractional cents', () => {
    // 33.33% / 33.33% / 33.34% of $10.01
    const splits = computeSplits(1001, 'PERCENTAGE', [
      { userId: 'a', value: 3333 },
      { userId: 'b', value: 3333 },
      { userId: 'c', value: 3334 },
    ]);
    expect(sumOwed(splits)).toBe(1001);
  });

  it('rejects percentages that do not total 100%', () => {
    expect(() =>
      computeSplits(1000, 'PERCENTAGE', [
        { userId: 'a', value: 5000 },
        { userId: 'b', value: 4000 },
      ]),
    ).toThrow(/100%/);
  });
});

describe('computeSplits — SHARES', () => {
  it('splits by ratio', () => {
    const splits = computeSplits(3000, 'SHARES', [
      { userId: 'a', value: 2 },
      { userId: 'b', value: 1 },
    ]);
    expect(splits.map((s) => s.owedAmountMinor)).toEqual([2000, 1000]);
  });

  it('conserves the total on an awkward ratio', () => {
    const splits = computeSplits(1000, 'SHARES', [
      { userId: 'a', value: 3 },
      { userId: 'b', value: 2 },
      { userId: 'c', value: 2 },
    ]);
    expect(sumOwed(splits)).toBe(1000);
    // Floors are 428/285/285 (998); the two leftover cents go to the two
    // largest remainders, which are the 2-share participants.
    expect(splits.map((s) => s.owedAmountMinor)).toEqual([428, 286, 286]);
  });

  it('preserves the entered share value for later editing', () => {
    const splits = computeSplits(3000, 'SHARES', [
      { userId: 'a', value: 2 },
      { userId: 'b', value: 1 },
    ]);
    expect(splits.map((s) => s.shareValue)).toEqual([2, 1]);
  });
});

describe('computeSplits — validation', () => {
  it('rejects a zero or negative total', () => {
    expect(() => computeSplits(0, 'EQUAL', [{ userId: 'a' }])).toThrow(/greater than zero/);
    expect(() => computeSplits(-100, 'EQUAL', [{ userId: 'a' }])).toThrow(/greater than zero/);
  });

  it('rejects an empty participant list', () => {
    expect(() => computeSplits(100, 'EQUAL', [])).toThrow(/at least one participant/);
  });

  it('rejects duplicate participants', () => {
    expect(() =>
      computeSplits(100, 'EQUAL', [{ userId: 'a' }, { userId: 'a' }]),
    ).toThrow(/Duplicate participant/);
  });

  it('requires a value for every participant in a valued split', () => {
    expect(() =>
      computeSplits(100, 'EXACT', [{ userId: 'a', value: 100 }, { userId: 'b' }]),
    ).toThrow(/requires a value/);
  });
});

describe('validatePayers', () => {
  it('accepts a single payer covering the total', () => {
    expect(() => validatePayers(1000, [{ userId: 'a', amountMinor: 1000 }])).not.toThrow();
  });

  it('accepts multiple payers summing to the total', () => {
    expect(() =>
      validatePayers(1000, [
        { userId: 'a', amountMinor: 600 },
        { userId: 'b', amountMinor: 400 },
      ]),
    ).not.toThrow();
  });

  it('rejects payments that do not cover the expense', () => {
    expect(() => validatePayers(1000, [{ userId: 'a', amountMinor: 900 }])).toThrow(
      /Payments total/,
    );
  });

  it('rejects an expense with no payer', () => {
    expect(() => validatePayers(1000, [])).toThrow(/at least one payer/);
  });

  it('rejects duplicate payers', () => {
    expect(() =>
      validatePayers(1000, [
        { userId: 'a', amountMinor: 500 },
        { userId: 'a', amountMinor: 500 },
      ]),
    ).toThrow(/Duplicate payer/);
  });
});
