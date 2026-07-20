import { prisma } from '../db';
import { rateToScaled, RATE_SCALE, type RateLookup } from '../money/conversion';
import { isSupportedCurrency } from '../money/currency';
import { startOfUtcDay } from '../core/recurrence';

/**
 * Daily FX rates, fetched once per day and cached in Postgres.
 *
 * The brief was explicit that rates must not be fetched per request, and the
 * reason is not just latency: a balance screen that re-fetched would show a
 * different total on every pull-to-refresh. Pinning to a daily rate makes the
 * displayed number stable and reproducible.
 *
 * Provider is exchangerate.host (no API key). If it is unavailable the most
 * recent cached rates are used, and if there are none the conversion layer
 * reports the currency as unconvertible rather than inventing a number.
 */

const PROVIDER_URL = 'https://api.exchangerate.host/latest';
const BASE = 'USD';

export interface RateSyncResult {
  date: string;
  ratesStored: number;
  source: 'provider' | 'cache';
  error?: string;
}

/** Fetch today's rates against USD and upsert them. Safe to call repeatedly. */
export async function syncDailyRates(now = new Date()): Promise<RateSyncResult> {
  const date = startOfUtcDay(now);
  const dateLabel = date.toISOString().slice(0, 10);

  const existing = await prisma.exchangeRate.count({ where: { date } });
  if (existing > 0) {
    return { date: dateLabel, ratesStored: existing, source: 'cache' };
  }

  let rates: Record<string, number>;
  try {
    const res = await fetch(`${PROVIDER_URL}?base=${BASE}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Provider returned ${res.status}`);

    const payload = (await res.json()) as { rates?: Record<string, number> };
    if (!payload.rates || Object.keys(payload.rates).length === 0) {
      throw new Error('Provider returned no rates');
    }
    rates = payload.rates;
  } catch (err) {
    // Not fatal: stale rates beat no balances at all.
    return {
      date: dateLabel,
      ratesStored: 0,
      source: 'cache',
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const rows = Object.entries(rates)
    .filter(([code, rate]) => isSupportedCurrency(code) && Number.isFinite(rate) && rate > 0)
    .map(([code, rate]) => ({
      baseCurrency: BASE,
      quoteCurrency: code,
      rateScaled: rateToScaled(rate),
      date,
    }));

  if (rows.length > 0) {
    await prisma.exchangeRate.createMany({ data: rows, skipDuplicates: true });
  }

  return { date: dateLabel, ratesStored: rows.length, source: 'provider' };
}

/**
 * Build an in-memory lookup for a single request.
 *
 * Rates are stored only against USD, so a EUR->GBP conversion is derived by
 * triangulating through the base. Doing that once per request beats a DB round
 * trip per currency pair.
 */
export async function buildRateLookup(now = new Date()): Promise<RateLookup> {
  // Use the newest date we actually have, which may be older than today if the
  // provider has been down.
  const latest = await prisma.exchangeRate.findFirst({
    where: { date: { lte: startOfUtcDay(now) } },
    orderBy: { date: 'desc' },
    select: { date: true },
  });

  if (!latest) return () => null;

  const rows = await prisma.exchangeRate.findMany({ where: { date: latest.date } });

  // quotePerBase[X] = how many X one USD buys.
  const quotePerBase = new Map<string, bigint>([[BASE, RATE_SCALE]]);
  for (const row of rows) quotePerBase.set(row.quoteCurrency, row.rateScaled);

  return (from: string, to: string): bigint | null => {
    if (from === to) return RATE_SCALE;

    const fromRate = quotePerBase.get(from);
    const toRate = quotePerBase.get(to);
    if (fromRate === undefined || toRate === undefined || fromRate === 0n) return null;

    // from -> USD -> to, kept in scaled integer space throughout.
    return (toRate * RATE_SCALE) / fromRate;
  };
}
