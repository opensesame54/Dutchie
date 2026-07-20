import { toMinorUnits, fromMinorUnits, minorUnitExponent, isSupportedCurrency } from './currency';

describe('toMinorUnits', () => {
  it('converts two-decimal currencies', () => {
    expect(toMinorUnits('12.34', 'USD')).toBe(1234);
    expect(toMinorUnits('0.05', 'USD')).toBe(5);
    expect(toMinorUnits('100', 'USD')).toBe(10_000);
  });

  it('pads a short fraction', () => {
    expect(toMinorUnits('12.3', 'USD')).toBe(1230);
  });

  it('handles zero-decimal currencies', () => {
    expect(toMinorUnits('1000', 'JPY')).toBe(1000);
  });

  it('handles three-decimal currencies', () => {
    expect(toMinorUnits('1.234', 'KWD')).toBe(1234);
  });

  it('handles negative amounts', () => {
    expect(toMinorUnits('-12.34', 'USD')).toBe(-1234);
  });

  it('rejects more precision than the currency has', () => {
    expect(() => toMinorUnits('12.345', 'USD')).toThrow(/at most 2 decimal/);
    expect(() => toMinorUnits('12.5', 'JPY')).toThrow(/at most 0 decimal/);
  });

  it('rejects junk input', () => {
    expect(() => toMinorUnits('12.34.56', 'USD')).toThrow(/Invalid amount/);
    expect(() => toMinorUnits('abc', 'USD')).toThrow(/Invalid amount/);
    expect(() => toMinorUnits('', 'USD')).toThrow(/Invalid amount/);
  });

  it('rejects unsupported currencies', () => {
    expect(() => toMinorUnits('1.00', 'XYZ')).toThrow(/Unsupported currency/);
  });
});

describe('fromMinorUnits', () => {
  it('formats two-decimal currencies', () => {
    expect(fromMinorUnits(1234, 'USD')).toBe('12.34');
    expect(fromMinorUnits(5, 'USD')).toBe('0.05');
    expect(fromMinorUnits(0, 'USD')).toBe('0.00');
  });

  it('formats zero-decimal currencies', () => {
    expect(fromMinorUnits(1000, 'JPY')).toBe('1000');
  });

  it('formats negative amounts', () => {
    expect(fromMinorUnits(-1234, 'USD')).toBe('-12.34');
    expect(fromMinorUnits(-5, 'USD')).toBe('-0.05');
  });

  it('round-trips', () => {
    for (const [value, currency] of [
      ['12.34', 'USD'], ['0.01', 'USD'], ['999999.99', 'USD'],
      ['1000', 'JPY'], ['1.234', 'KWD'], ['-45.60', 'EUR'],
    ] as const) {
      expect(fromMinorUnits(toMinorUnits(value, currency), currency)).toBe(value);
    }
  });
});

describe('currency metadata', () => {
  it('knows common exponents', () => {
    expect(minorUnitExponent('USD')).toBe(2);
    expect(minorUnitExponent('JPY')).toBe(0);
    expect(minorUnitExponent('KWD')).toBe(3);
  });

  it('reports support correctly', () => {
    expect(isSupportedCurrency('USD')).toBe(true);
    expect(isSupportedCurrency('XYZ')).toBe(false);
    // Guard against prototype keys leaking through the lookup.
    expect(isSupportedCurrency('constructor')).toBe(false);
  });
});
