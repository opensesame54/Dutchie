import { minorUnitExponent } from './currency';

/**
 * Currency conversion in exact integer arithmetic.
 *
 * Rates are stored as BigInt scaled by RATE_SCALE rather than as floats. A
 * float rate would reintroduce precisely the rounding error the rest of the
 * money path exists to prevent — and unlike a display rounding error, a bad
 * conversion silently misstates what someone owes.
 *
 * The conversion also has to cross differing minor-unit exponents: 1000 JPY
 * (exponent 0) into USD (exponent 2) is not a straight multiply.
 */

/** Rates are quote-per-1-base, scaled by 1e10. */
export const RATE_SCALE = 10_000_000_000n;

export function rateToScaled(rate: number): bigint {
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error(`Invalid exchange rate: ${rate}`);
  }
  // toFixed(10) matches RATE_SCALE's precision exactly, avoiding a float
  // multiply that would drop low-order digits.
  const [whole, fraction = ''] = rate.toFixed(10).split('.');
  return BigInt(whole) * RATE_SCALE + BigInt(fraction.padEnd(10, '0'));
}

export function scaledToRate(scaled: bigint): number {
  return Number(scaled) / Number(RATE_SCALE);
}

/** Divide two BigInts, rounding half away from zero. */
function divRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new Error('Division by zero in currency conversion');

  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;

  const quotient = n / d;
  const remainder = n % d;
  // Half-up: bump when the remainder is at least half the divisor.
  const rounded = remainder * 2n >= d ? quotient + 1n : quotient;

  return negative ? -rounded : rounded;
}

/**
 * Convert an amount in minor units from one currency to another.
 *
 * `rateScaled` is how many units of `to` one unit of `from` buys, scaled by
 * RATE_SCALE.
 */
export function convertMinor(
  amountMinor: number,
  from: string,
  to: string,
  rateScaled: bigint,
): number {
  if (!Number.isInteger(amountMinor)) {
    throw new Error(`convertMinor: amount must be an integer, got ${amountMinor}`);
  }
  if (from === to) return amountMinor;
  if (rateScaled <= 0n) throw new Error(`convertMinor: rate must be positive, got ${rateScaled}`);

  const expFrom = minorUnitExponent(from);
  const expTo = minorUnitExponent(to);

  // major_to   = major_from * rate
  // minor_to   = minor_from * rate * 10^expTo / 10^expFrom
  const numerator = BigInt(amountMinor) * rateScaled * 10n ** BigInt(expTo);
  const denominator = RATE_SCALE * 10n ** BigInt(expFrom);

  const result = divRoundHalfUp(numerator, denominator);

  if (result > BigInt(Number.MAX_SAFE_INTEGER) || result < -BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('convertMinor: result exceeds safe integer range');
  }

  return Number(result);
}

export interface RateLookup {
  /** Scaled rate for base->quote, or null when unavailable. */
  (from: string, to: string): bigint | null;
}

export interface ConversionResult {
  /** Converted total, in `displayCurrency` minor units. */
  totalMinor: number;
  /** Currencies that had no rate and were therefore left out of the total. */
  missing: string[];
}

/**
 * Fold a per-currency map into a single display currency.
 *
 * Anything without a rate is EXCLUDED and reported in `missing` rather than
 * being treated as 1:1 or silently dropped. A summary that quietly omits a
 * currency is a lie; one that says which currency it could not convert is
 * merely incomplete, and the UI can say so.
 */
export function convertTotals(
  amountsByCurrency: Record<string, number>,
  displayCurrency: string,
  lookup: RateLookup,
): ConversionResult {
  let totalMinor = 0;
  const missing: string[] = [];

  for (const [currency, amount] of Object.entries(amountsByCurrency)) {
    if (amount === 0) continue;

    if (currency === displayCurrency) {
      totalMinor += amount;
      continue;
    }

    const rate = lookup(currency, displayCurrency);
    if (rate === null) {
      missing.push(currency);
      continue;
    }

    totalMinor += convertMinor(amount, currency, displayCurrency, rate);
  }

  return { totalMinor, missing: [...new Set(missing)].sort() };
}
