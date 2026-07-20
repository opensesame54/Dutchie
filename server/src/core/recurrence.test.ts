import {
  parseRecurrenceRule, formatRecurrenceRule, nextOccurrence, occurrencesBetween,
  RecurrenceError,
} from './recurrence';

const utc = (s: string) => new Date(`${s}T00:00:00.000Z`);
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

describe('parseRecurrenceRule', () => {
  it('parses a simple monthly rule', () => {
    expect(parseRecurrenceRule('FREQ=MONTHLY;BYMONTHDAY=1')).toEqual({
      freq: 'MONTHLY', interval: 1, byMonthDay: 1,
    });
  });

  it('accepts an RRULE: prefix', () => {
    expect(parseRecurrenceRule('RRULE:FREQ=DAILY').freq).toBe('DAILY');
  });

  it('parses interval, byday, and count', () => {
    expect(parseRecurrenceRule('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,FR;COUNT=10')).toEqual({
      freq: 'WEEKLY', interval: 2, byDay: ['MO', 'FR'], count: 10,
    });
  });

  it('parses UNTIL in both basic formats', () => {
    expect(parseRecurrenceRule('FREQ=DAILY;UNTIL=20260131').until).toEqual(utc('2026-01-31'));
    expect(parseRecurrenceRule('FREQ=DAILY;UNTIL=20260131T000000Z').until).toEqual(
      utc('2026-01-31'),
    );
  });

  it('round-trips through format', () => {
    for (const rule of [
      'FREQ=MONTHLY;BYMONTHDAY=15',
      'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE',
      'FREQ=DAILY;COUNT=5',
    ]) {
      expect(formatRecurrenceRule(parseRecurrenceRule(rule))).toBe(rule);
    }
  });

  // Rejecting loudly matters more than being permissive: a silently
  // misinterpreted rule generates expenses nobody agreed to.
  it('rejects unsupported options rather than ignoring them', () => {
    expect(() => parseRecurrenceRule('FREQ=MONTHLY;BYSETPOS=1')).toThrow(/Unsupported recurrence option/);
    expect(() => parseRecurrenceRule('FREQ=MONTHLY;BYWEEKNO=2')).toThrow(/Unsupported/);
  });

  it('rejects negative BYMONTHDAY instead of misreading it', () => {
    expect(() => parseRecurrenceRule('FREQ=MONTHLY;BYMONTHDAY=-1')).toThrow(/between 1 and 31/);
  });

  it('rejects multiple BYMONTHDAY values', () => {
    expect(() => parseRecurrenceRule('FREQ=MONTHLY;BYMONTHDAY=1,15')).toThrow(/Multiple BYMONTHDAY/);
  });

  it('rejects malformed input', () => {
    expect(() => parseRecurrenceRule('')).toThrow(RecurrenceError);
    expect(() => parseRecurrenceRule('MONTHLY')).toThrow(/Malformed/);
    expect(() => parseRecurrenceRule('FREQ=FORTNIGHTLY')).toThrow(/Unsupported FREQ/);
    expect(() => parseRecurrenceRule('FREQ=DAILY;INTERVAL=0')).toThrow(/positive integer/);
    expect(() => parseRecurrenceRule('FREQ=DAILY;BYDAY=XX')).toThrow(/Invalid BYDAY/);
  });

  it('rejects COUNT and UNTIL together', () => {
    expect(() => parseRecurrenceRule('FREQ=DAILY;COUNT=3;UNTIL=20260131')).toThrow(
      /cannot both be set/,
    );
  });
});

describe('nextOccurrence — DAILY', () => {
  const rule = parseRecurrenceRule('FREQ=DAILY');

  it('advances one day', () => {
    expect(iso(nextOccurrence(rule, utc('2026-01-01'), utc('2026-01-05')))).toBe('2026-01-06');
  });

  it('respects INTERVAL from the anchor', () => {
    const every3 = parseRecurrenceRule('FREQ=DAILY;INTERVAL=3');
    expect(iso(nextOccurrence(every3, utc('2026-01-01'), utc('2026-01-01')))).toBe('2026-01-04');
    expect(iso(nextOccurrence(every3, utc('2026-01-01'), utc('2026-01-05')))).toBe('2026-01-07');
  });

  it('returns the anchor when asked from before the series starts', () => {
    expect(iso(nextOccurrence(rule, utc('2026-06-01'), utc('2026-01-01')))).toBe('2026-06-01');
  });
});

describe('nextOccurrence — WEEKLY', () => {
  it('repeats on the anchor weekday by default', () => {
    // 2026-01-01 is a Thursday.
    const rule = parseRecurrenceRule('FREQ=WEEKLY');
    expect(iso(nextOccurrence(rule, utc('2026-01-01'), utc('2026-01-01')))).toBe('2026-01-08');
  });

  it('handles BYDAY with several days', () => {
    const rule = parseRecurrenceRule('FREQ=WEEKLY;BYDAY=MO,WE,FR');
    // From Monday 2026-01-05 the next is Wednesday 2026-01-07.
    expect(iso(nextOccurrence(rule, utc('2026-01-05'), utc('2026-01-05')))).toBe('2026-01-07');
    expect(iso(nextOccurrence(rule, utc('2026-01-05'), utc('2026-01-07')))).toBe('2026-01-09');
    // Friday rolls to the following Monday.
    expect(iso(nextOccurrence(rule, utc('2026-01-05'), utc('2026-01-09')))).toBe('2026-01-12');
  });

  it('skips weeks when INTERVAL is 2', () => {
    const rule = parseRecurrenceRule('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO');
    expect(iso(nextOccurrence(rule, utc('2026-01-05'), utc('2026-01-05')))).toBe('2026-01-19');
  });
});

describe('nextOccurrence — MONTHLY', () => {
  it('repeats on the same day each month', () => {
    const rule = parseRecurrenceRule('FREQ=MONTHLY;BYMONTHDAY=1');
    expect(iso(nextOccurrence(rule, utc('2026-01-01'), utc('2026-01-01')))).toBe('2026-02-01');
    expect(iso(nextOccurrence(rule, utc('2026-01-01'), utc('2026-02-15')))).toBe('2026-03-01');
  });

  it('clamps to the last day of a short month', () => {
    // Deliberate deviation from RFC 5545, which would skip February entirely.
    // Rent due "on the 31st" must still be charged in February.
    const rule = parseRecurrenceRule('FREQ=MONTHLY;BYMONTHDAY=31');
    expect(iso(nextOccurrence(rule, utc('2026-01-31'), utc('2026-01-31')))).toBe('2026-02-28');
    expect(iso(nextOccurrence(rule, utc('2026-01-31'), utc('2026-02-28')))).toBe('2026-03-31');
  });

  it('handles February in a leap year', () => {
    const rule = parseRecurrenceRule('FREQ=MONTHLY;BYMONTHDAY=30');
    // 2028 is a leap year, so February has 29 days.
    expect(iso(nextOccurrence(rule, utc('2028-01-30'), utc('2028-01-30')))).toBe('2028-02-29');
  });

  it('does not drift after clamping', () => {
    // The anchor day (31) must be remembered, not replaced by the clamped 28.
    const rule = parseRecurrenceRule('FREQ=MONTHLY;BYMONTHDAY=31');
    let cursor = utc('2026-01-31');
    const seen: (string | null)[] = [];
    for (let i = 0; i < 4; i += 1) {
      const next = nextOccurrence(rule, utc('2026-01-31'), cursor)!;
      seen.push(iso(next));
      cursor = next;
    }
    expect(seen).toEqual(['2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31']);
  });

  it('respects INTERVAL', () => {
    const rule = parseRecurrenceRule('FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=15');
    expect(iso(nextOccurrence(rule, utc('2026-01-15'), utc('2026-01-15')))).toBe('2026-04-15');
  });
});

describe('nextOccurrence — YEARLY', () => {
  it('repeats annually', () => {
    const rule = parseRecurrenceRule('FREQ=YEARLY');
    expect(iso(nextOccurrence(rule, utc('2026-03-10'), utc('2026-03-10')))).toBe('2027-03-10');
  });
});

describe('series termination', () => {
  it('stops at UNTIL', () => {
    const rule = parseRecurrenceRule('FREQ=MONTHLY;BYMONTHDAY=1;UNTIL=20260301');
    expect(iso(nextOccurrence(rule, utc('2026-01-01'), utc('2026-01-01')))).toBe('2026-02-01');
    expect(iso(nextOccurrence(rule, utc('2026-01-01'), utc('2026-02-01')))).toBe('2026-03-01');
    expect(nextOccurrence(rule, utc('2026-01-01'), utc('2026-03-01'))).toBeNull();
  });

  it('stops once COUNT is reached', () => {
    const rule = parseRecurrenceRule('FREQ=DAILY;COUNT=3');
    expect(nextOccurrence(rule, utc('2026-01-01'), utc('2026-01-01'), 0)).not.toBeNull();
    expect(nextOccurrence(rule, utc('2026-01-01'), utc('2026-01-01'), 3)).toBeNull();
  });
});

describe('occurrencesBetween', () => {
  it('catches up every missed occurrence exactly once', () => {
    // The generator was down for four months; all four rents must appear.
    const rule = parseRecurrenceRule('FREQ=MONTHLY;BYMONTHDAY=1');
    const dates = occurrencesBetween(rule, utc('2026-01-01'), utc('2026-01-01'), utc('2026-05-02'));
    expect(dates.map(iso)).toEqual(['2026-02-01', '2026-03-01', '2026-04-01', '2026-05-01']);
  });

  it('returns nothing when nothing is due', () => {
    const rule = parseRecurrenceRule('FREQ=MONTHLY;BYMONTHDAY=1');
    expect(occurrencesBetween(rule, utc('2026-01-01'), utc('2026-01-01'), utc('2026-01-20'))).toEqual([]);
  });

  it('honours UNTIL while catching up', () => {
    const rule = parseRecurrenceRule('FREQ=MONTHLY;BYMONTHDAY=1;UNTIL=20260301');
    const dates = occurrencesBetween(rule, utc('2026-01-01'), utc('2026-01-01'), utc('2026-12-01'));
    expect(dates.map(iso)).toEqual(['2026-02-01', '2026-03-01']);
  });

  it('honours COUNT while catching up', () => {
    const rule = parseRecurrenceRule('FREQ=MONTHLY;BYMONTHDAY=1;COUNT=2');
    const dates = occurrencesBetween(rule, utc('2026-01-01'), utc('2026-01-01'), utc('2026-12-01'), 0);
    expect(dates.map(iso)).toEqual(['2026-02-01', '2026-03-01']);
  });

  it('never produces duplicates over a long catch-up', () => {
    const rule = parseRecurrenceRule('FREQ=WEEKLY;BYDAY=MO');
    const dates = occurrencesBetween(rule, utc('2026-01-05'), utc('2026-01-05'), utc('2026-06-01'));
    expect(new Set(dates.map(iso)).size).toBe(dates.length);
    expect(dates.every((d) => d.getUTCDay() === 1)).toBe(true);
  });

  it('is bounded so a runaway rule cannot hang the generator', () => {
    const rule = parseRecurrenceRule('FREQ=DAILY');
    const dates = occurrencesBetween(
      rule, utc('2020-01-01'), utc('2020-01-01'), utc('2030-01-01'), 0, 50,
    );
    expect(dates).toHaveLength(50);
  });
});
