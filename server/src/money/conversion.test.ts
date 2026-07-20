import {
  convertMinor, convertTotals, rateToScaled, scaledToRate, RATE_SCALE,
} from './conversion';

describe('rate scaling', () => {
  it('round-trips a rate', () => {
    expect(scaledToRate(rateToScaled(1.0865))).toBeCloseTo(1.0865, 9);
  });

  it('scales exactly', () => {
    expect(rateToScaled(1)).toBe(RATE_SCALE);
    expect(rateToScaled(0.5)).toBe(RATE_SCALE / 2n);
  });

  it('rejects nonsense rates', () => {
    expect(() => rateToScaled(0)).toThrow(/Invalid exchange rate/);
    expect(() => rateToScaled(-1)).toThrow(/Invalid exchange rate/);
    expect(() => rateToScaled(NaN)).toThrow(/Invalid exchange rate/);
  });
});

describe('convertMinor', () => {
  it('is a no-op for the same currency', () => {
    expect(convertMinor(1234, 'USD', 'USD', rateToScaled(999))).toBe(1234);
  });

  it('converts between two-decimal currencies', () => {
    // EUR 100.00 at 1.10 -> USD 110.00
    expect(convertMinor(10_000, 'EUR', 'USD', rateToScaled(1.1))).toBe(11_000);
  });

  it('rounds half up to the nearest minor unit', () => {
    // 1 cent at 1.005 = 1.005 cents -> 1 cent
    expect(convertMinor(1, 'EUR', 'USD', rateToScaled(1.005))).toBe(1);
    // 10 cents at 1.05 = 10.5 -> 11
    expect(convertMinor(10, 'EUR', 'USD', rateToScaled(1.05))).toBe(11);
  });

  it('crosses differing minor-unit exponents', () => {
    // JPY has no minor unit. 1000 JPY at 0.0067 USD/JPY -> 6.70 USD = 670 minor.
    expect(convertMinor(1000, 'JPY', 'USD', rateToScaled(0.0067))).toBe(670);
    // And back: USD 6.70 at 149.25 JPY/USD -> 1000 JPY.
    expect(convertMinor(670, 'USD', 'JPY', rateToScaled(149.2537))).toBe(1000);
  });

  it('handles three-decimal currencies', () => {
    // KWD exponent 3. 1.000 KWD at 3.25 USD/KWD -> 3.25 USD.
    expect(convertMinor(1000, 'KWD', 'USD', rateToScaled(3.25))).toBe(325);
  });

  it('handles large amounts without precision loss', () => {
    // 10,000,000.00 EUR at exactly 1.1
    expect(convertMinor(1_000_000_000, 'EUR', 'USD', rateToScaled(1.1))).toBe(1_100_000_000);
  });

  it('handles negative amounts symmetrically', () => {
    expect(convertMinor(-10_000, 'EUR', 'USD', rateToScaled(1.1))).toBe(-11_000);
  });

  it('rejects invalid input', () => {
    expect(() => convertMinor(1.5, 'EUR', 'USD', rateToScaled(1.1))).toThrow(/must be an integer/);
    expect(() => convertMinor(100, 'EUR', 'USD', 0n)).toThrow(/must be positive/);
    expect(() => convertMinor(100, 'EUR', 'XYZ', rateToScaled(1.1))).toThrow(/Unsupported currency/);
  });

  it('does not accumulate float drift over many conversions', () => {
    // The classic float failure: 0.1 added 10 times !== 1.0. Integer maths
    // must land exactly on the expected total.
    const rate = rateToScaled(1.1);
    let total = 0;
    for (let i = 0; i < 1000; i += 1) total += convertMinor(10, 'EUR', 'USD', rate);
    expect(total).toBe(11_000);
  });
});

describe('convertTotals', () => {
  const lookup = (from: string, to: string) => {
    if (from === 'EUR' && to === 'USD') return rateToScaled(1.1);
    if (from === 'GBP' && to === 'USD') return rateToScaled(1.27);
    return null;
  };

  it('folds several currencies into one', () => {
    const result = convertTotals({ USD: 5000, EUR: 10_000, GBP: 10_000 }, 'USD', lookup);
    // 50.00 + 110.00 + 127.00
    expect(result.totalMinor).toBe(28_700);
    expect(result.missing).toEqual([]);
  });

  it('reports currencies it could not convert instead of guessing', () => {
    const result = convertTotals({ USD: 5000, JPY: 100_000 }, 'USD', lookup);
    expect(result.totalMinor).toBe(5000);
    expect(result.missing).toEqual(['JPY']);
  });

  it('never treats a missing rate as 1:1', () => {
    const result = convertTotals({ JPY: 100_000 }, 'USD', lookup);
    expect(result.totalMinor).toBe(0);
    expect(result.missing).toEqual(['JPY']);
  });

  it('skips zero balances', () => {
    const result = convertTotals({ EUR: 0, JPY: 0 }, 'USD', lookup);
    expect(result.totalMinor).toBe(0);
    // A zero balance in an unconvertible currency is not a real gap.
    expect(result.missing).toEqual([]);
  });

  it('handles an empty map', () => {
    expect(convertTotals({}, 'USD', lookup)).toEqual({ totalMinor: 0, missing: [] });
  });

  it('handles negative (owing) balances', () => {
    const result = convertTotals({ EUR: -10_000 }, 'USD', lookup);
    expect(result.totalMinor).toBe(-11_000);
  });
});
