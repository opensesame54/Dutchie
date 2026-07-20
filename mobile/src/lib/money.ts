/**
 * Client-side money formatting.
 *
 * The server is the authority on arithmetic — the app only ever formats minor
 * units it was given. It never adds or splits amounts itself, so there is no
 * second implementation of the rounding rules to drift out of sync.
 */

const EXPONENTS: Record<string, number> = {
  JPY: 0, KRW: 0, VND: 0, CLP: 0, ISK: 0, HUF: 0,
  BHD: 3, KWD: 3, OMR: 3, JOD: 3, TND: 3,
};

function exponentFor(currency: string): number {
  return EXPONENTS[currency] ?? 2;
}

/** 1234 USD -> "12.34" (digits only, no symbol). */
export function formatMinor(minor: number, currency: string): string {
  const exp = exponentFor(currency);
  const negative = minor < 0;
  const abs = Math.abs(minor);

  if (exp === 0) return `${negative ? '-' : ''}${abs.toLocaleString()}`;

  const divisor = 10 ** exp;
  const whole = Math.floor(abs / divisor);
  const fraction = String(abs % divisor).padStart(exp, '0');
  return `${negative ? '-' : ''}${whole.toLocaleString()}.${fraction}`;
}

const SYMBOLS: Record<string, string> = {
  USD: '$', EUR: '€', GBP: '£', JPY: '¥', INR: '₹',
  CAD: 'CA$', AUD: 'A$', CHF: 'CHF ', SEK: 'kr ', NOK: 'kr ', BRL: 'R$',
};

export function currencySymbol(currency: string): string {
  return SYMBOLS[currency] ?? `${currency} `;
}

/** Display form with symbol, e.g. "$12.34". */
export function formatMoney(minor: number, currency: string): string {
  const negative = minor < 0;
  return `${negative ? '-' : ''}${currencySymbol(currency)}${formatMinor(Math.abs(minor), currency)}`;
}

/**
 * Parse user input into minor units, mirroring the server's rules so the form
 * can reject bad input before a round-trip. Returns null when unparseable.
 */
export function parseToMinor(input: string, currency: string): number | null {
  const trimmed = input.trim().replace(/,/g, '');
  if (!/^\d*\.?\d*$/.test(trimmed) || trimmed === '' || trimmed === '.') return null;

  const exp = exponentFor(currency);
  const [whole, fraction = ''] = trimmed.split('.');
  if (fraction.length > exp) return null;

  return Number(whole || '0') * 10 ** exp + Number(fraction.padEnd(exp, '0') || '0');
}
