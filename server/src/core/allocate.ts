/**
 * Proportional allocation of an integer total across integer weights.
 *
 * This is the primitive every split type is built on. The invariant that
 * matters: the allocation ALWAYS sums to exactly the total. Splitting $10.00
 * three ways must produce 3.34 / 3.33 / 3.33, never 3.33 x 3 with a lost cent.
 *
 * Uses the largest-remainder (Hamilton) method: floor everything, then hand the
 * leftover units to whoever was rounded down hardest. Ties break by index so
 * the result is deterministic — the same expense always splits the same way,
 * which matters because users notice when a cent moves between refreshes.
 */
export function allocate(total: number, weights: number[]): number[] {
  if (!Number.isInteger(total)) {
    throw new Error(`allocate: total must be an integer, got ${total}`);
  }
  if (weights.length === 0) {
    if (total !== 0) throw new Error('allocate: cannot allocate a non-zero total across zero weights');
    return [];
  }
  if (weights.some((w) => !Number.isInteger(w) || w < 0)) {
    throw new Error('allocate: weights must be non-negative integers');
  }

  const totalWeight = weights.reduce((a, b) => a + b, 0);
  if (totalWeight === 0) {
    throw new Error('allocate: total weight must be greater than zero');
  }

  // Work in absolute value so flooring behaves symmetrically for refunds
  // (negative totals); the sign is reapplied at the end.
  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);

  const base = weights.map((w) => Math.floor((abs * w) / totalWeight));
  const remainders = weights.map((w, i) => ({
    index: i,
    remainder: abs * w - base[i] * totalWeight,
  }));

  let leftover = abs - base.reduce((a, b) => a + b, 0);

  // Largest remainder first; stable on index for determinism.
  remainders.sort((a, b) => b.remainder - a.remainder || a.index - b.index);

  for (const { index } of remainders) {
    if (leftover <= 0) break;
    // Never hand a unit to a zero-weight participant — someone excluded from a
    // split must stay at exactly zero.
    if (weights[index] === 0) continue;
    base[index] += 1;
    leftover -= 1;
  }

  return base.map((v) => v * sign);
}
