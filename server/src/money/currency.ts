/**
 * Currency metadata. All money in Dutchie is handled as integer minor units;
 * this table is the only place that knows how many minor units a currency has.
 */

const EXPONENTS: Record<string, number> = {
  USD: 2, EUR: 2, GBP: 2, CAD: 2, AUD: 2, NZD: 2, CHF: 2, SEK: 2, NOK: 2,
  DKK: 2, PLN: 2, CZK: 2, MXN: 2, BRL: 2, ARS: 2, ZAR: 2, INR: 2, CNY: 2,
  HKD: 2, SGD: 2, THB: 2, PHP: 2, MYR: 2, IDR: 2, TRY: 2, ILS: 2, AED: 2,
  SAR: 2, RUB: 2,
  // Zero-decimal currencies: 1 unit is the smallest unit there is.
  JPY: 0, KRW: 0, VND: 0, CLP: 0, ISK: 0, HUF: 0,
  // Three-decimal currencies.
  BHD: 3, KWD: 3, OMR: 3, JOD: 3, TND: 3,
};

export const SUPPORTED_CURRENCIES = Object.keys(EXPONENTS).sort();

export function isSupportedCurrency(code: string): boolean {
  return Object.prototype.hasOwnProperty.call(EXPONENTS, code);
}

export function minorUnitExponent(code: string): number {
  const exp = EXPONENTS[code];
  if (exp === undefined) throw new Error(`Unsupported currency: ${code}`);
  return exp;
}

/** "12.34" USD -> 1234. Throws if the input has more precision than the currency allows. */
export function toMinorUnits(amount: string | number, currency: string): number {
  const exp = minorUnitExponent(currency);
  const str = typeof amount === 'number' ? amount.toFixed(exp) : amount.trim();

  if (!/^-?\d+(\.\d+)?$/.test(str)) {
    throw new Error(`Invalid amount: ${amount}`);
  }

  const negative = str.startsWith('-');
  const [whole, fraction = ''] = str.replace('-', '').split('.');

  if (fraction.length > exp) {
    throw new Error(`${currency} supports at most ${exp} decimal places, got "${str}"`);
  }

  const padded = fraction.padEnd(exp, '0');
  const minor = Number(whole) * 10 ** exp + Number(padded || '0');
  return negative ? -minor : minor;
}

/** 1234 USD -> "12.34". */
export function fromMinorUnits(minor: number, currency: string): string {
  const exp = minorUnitExponent(currency);
  if (exp === 0) return String(minor);

  const negative = minor < 0;
  const abs = Math.abs(minor).toString().padStart(exp + 1, '0');
  const whole = abs.slice(0, abs.length - exp);
  const fraction = abs.slice(abs.length - exp);
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}
