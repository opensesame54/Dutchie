import { allocate } from './allocate';

describe('allocate', () => {
  it('splits evenly when it divides cleanly', () => {
    expect(allocate(900, [1, 1, 1])).toEqual([300, 300, 300]);
  });

  it('never loses a cent to rounding', () => {
    // The canonical case: $10.00 three ways.
    const result = allocate(1000, [1, 1, 1]);
    expect(result).toEqual([334, 333, 333]);
    expect(result.reduce((a, b) => a + b, 0)).toBe(1000);
  });

  it('distributes leftover units to the largest remainders', () => {
    // 1001 across weights 1:1:1 -> two participants absorb the extra cents.
    expect(allocate(1001, [1, 1, 1])).toEqual([334, 334, 333]);
  });

  it('respects weight ratios', () => {
    expect(allocate(3000, [2, 1])).toEqual([2000, 1000]);
    expect(allocate(1000, [3, 1])).toEqual([750, 250]);
  });

  it('is deterministic across repeated calls', () => {
    const a = allocate(1000, [1, 1, 1]);
    const b = allocate(1000, [1, 1, 1]);
    expect(a).toEqual(b);
  });

  it('keeps zero-weight participants at exactly zero', () => {
    const result = allocate(1000, [1, 0, 1, 0]);
    expect(result[1]).toBe(0);
    expect(result[3]).toBe(0);
    expect(result.reduce((a, b) => a + b, 0)).toBe(1000);
  });

  it('handles negative totals (refunds) symmetrically', () => {
    const result = allocate(-1000, [1, 1, 1]);
    expect(result.reduce((a, b) => a + b, 0)).toBe(-1000);
    expect(result).toEqual([-334, -333, -333]);
  });

  it('handles zero-decimal currency amounts', () => {
    // 1000 JPY across 3 people — no sub-unit to hide rounding in.
    const result = allocate(1000, [1, 1, 1]);
    expect(result.reduce((a, b) => a + b, 0)).toBe(1000);
  });

  it('handles a single participant', () => {
    expect(allocate(1234, [1])).toEqual([1234]);
  });

  it('handles large groups', () => {
    const weights = Array(97).fill(1);
    const result = allocate(10_000, weights);
    expect(result.reduce((a, b) => a + b, 0)).toBe(10_000);
  });

  it('rejects a non-integer total', () => {
    expect(() => allocate(10.5, [1, 1])).toThrow(/must be an integer/);
  });

  it('rejects negative weights', () => {
    expect(() => allocate(100, [1, -1])).toThrow(/non-negative/);
  });

  it('rejects an all-zero weight vector', () => {
    expect(() => allocate(100, [0, 0])).toThrow(/greater than zero/);
  });

  // Randomised conservation check. Rounding bugs hide in specific numbers, so
  // sweep a lot of them rather than trusting hand-picked cases.
  it('always sums to the total across randomised inputs', () => {
    for (let trial = 0; trial < 2000; trial += 1) {
      const total = Math.floor(Math.random() * 1_000_000);
      const count = 1 + Math.floor(Math.random() * 12);
      const weights = Array.from(
        { length: count },
        () => Math.floor(Math.random() * 10) + (count === 1 ? 1 : 0),
      );
      if (weights.reduce((a, b) => a + b, 0) === 0) continue;

      const result = allocate(total, weights);
      expect(result.reduce((a, b) => a + b, 0)).toBe(total);
      // No one should be off by more than a single minor unit from their exact share.
      const totalWeight = weights.reduce((a, b) => a + b, 0);
      result.forEach((amount, i) => {
        const exact = (total * weights[i]) / totalWeight;
        expect(Math.abs(amount - exact)).toBeLessThan(1);
      });
    }
  });
});
