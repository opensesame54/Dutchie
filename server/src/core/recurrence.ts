/**
 * Recurrence rules for repeating expenses.
 *
 * This implements a deliberate SUBSET of RFC 5545 RRULE — the part that
 * actually describes shared household costs: rent on the 1st, a subscription
 * every month, a cleaner every other week. Anything beyond that subset is
 * rejected loudly at parse time rather than silently producing wrong dates,
 * because a recurrence bug quietly invents money that nobody spent.
 *
 * Supported:  FREQ=DAILY|WEEKLY|MONTHLY|YEARLY, INTERVAL, BYMONTHDAY, BYDAY,
 *             COUNT, UNTIL
 * Not supported: BYSETPOS, BYWEEKNO, BYYEARDAY, WKST, multiple BYMONTHDAY
 *
 * All arithmetic is UTC. Local time would drag DST into the schedule, and
 * "rent is due on the 1st" must not shift by an hour twice a year.
 */

export type Frequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';

export const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export interface RecurrenceRule {
  freq: Frequency;
  interval: number;
  byMonthDay?: number;
  byDay?: Weekday[];
  count?: number;
  until?: Date;
}

export class RecurrenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RecurrenceError';
  }
}

const SUPPORTED_KEYS = new Set([
  'FREQ', 'INTERVAL', 'BYMONTHDAY', 'BYDAY', 'COUNT', 'UNTIL',
]);

/** Parse an RRULE string such as "FREQ=MONTHLY;BYMONTHDAY=1". */
export function parseRecurrenceRule(input: string): RecurrenceRule {
  const trimmed = input.trim().replace(/^RRULE:/i, '');
  if (!trimmed) throw new RecurrenceError('Recurrence rule is empty');

  const parts = new Map<string, string>();
  for (const segment of trimmed.split(';')) {
    if (!segment) continue;
    const idx = segment.indexOf('=');
    if (idx === -1) throw new RecurrenceError(`Malformed rule segment: "${segment}"`);
    const key = segment.slice(0, idx).toUpperCase();
    parts.set(key, segment.slice(idx + 1).toUpperCase());
  }

  for (const key of parts.keys()) {
    if (!SUPPORTED_KEYS.has(key)) {
      throw new RecurrenceError(`Unsupported recurrence option: ${key}`);
    }
  }

  const freq = parts.get('FREQ');
  if (!freq) throw new RecurrenceError('Recurrence rule needs a FREQ');
  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq)) {
    throw new RecurrenceError(`Unsupported FREQ: ${freq}`);
  }

  const rule: RecurrenceRule = { freq: freq as Frequency, interval: 1 };

  if (parts.has('INTERVAL')) {
    const interval = Number(parts.get('INTERVAL'));
    if (!Number.isInteger(interval) || interval < 1) {
      throw new RecurrenceError(`INTERVAL must be a positive integer, got "${parts.get('INTERVAL')}"`);
    }
    rule.interval = interval;
  }

  if (parts.has('BYMONTHDAY')) {
    const raw = parts.get('BYMONTHDAY')!;
    if (raw.includes(',')) {
      throw new RecurrenceError('Multiple BYMONTHDAY values are not supported');
    }
    const day = Number(raw);
    // Negative days ("-1" = last day of month) are valid RFC but not handled
    // here; rejecting beats silently treating -1 as the 1st.
    if (!Number.isInteger(day) || day < 1 || day > 31) {
      throw new RecurrenceError(`BYMONTHDAY must be between 1 and 31, got "${raw}"`);
    }
    rule.byMonthDay = day;
  }

  if (parts.has('BYDAY')) {
    const days = parts.get('BYDAY')!.split(',').map((d) => d.trim());
    for (const d of days) {
      if (!WEEKDAYS.includes(d as Weekday)) {
        throw new RecurrenceError(`Invalid BYDAY value: "${d}"`);
      }
    }
    rule.byDay = days as Weekday[];
  }

  if (parts.has('COUNT')) {
    const count = Number(parts.get('COUNT'));
    if (!Number.isInteger(count) || count < 1) {
      throw new RecurrenceError(`COUNT must be a positive integer, got "${parts.get('COUNT')}"`);
    }
    rule.count = count;
  }

  if (parts.has('UNTIL')) {
    const until = parseUntil(parts.get('UNTIL')!);
    rule.until = until;
  }

  if (rule.count !== undefined && rule.until !== undefined) {
    throw new RecurrenceError('COUNT and UNTIL cannot both be set');
  }

  return rule;
}

/** RFC 5545 basic-format timestamps: 20260131 or 20260131T000000Z. */
function parseUntil(raw: string): Date {
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z?)?$/.exec(raw);
  if (!match) throw new RecurrenceError(`Malformed UNTIL value: "${raw}"`);

  const [, y, mo, d, h = '00', mi = '00', s = '00'] = match;
  const date = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s));
  if (Number.isNaN(date.getTime())) throw new RecurrenceError(`Invalid UNTIL date: "${raw}"`);
  return date;
}

export function formatRecurrenceRule(rule: RecurrenceRule): string {
  const parts = [`FREQ=${rule.freq}`];
  if (rule.interval !== 1) parts.push(`INTERVAL=${rule.interval}`);
  if (rule.byMonthDay) parts.push(`BYMONTHDAY=${rule.byMonthDay}`);
  if (rule.byDay?.length) parts.push(`BYDAY=${rule.byDay.join(',')}`);
  if (rule.count) parts.push(`COUNT=${rule.count}`);
  if (rule.until) {
    const iso = rule.until.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    parts.push(`UNTIL=${iso}`);
  }
  return parts.join(';');
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Midnight UTC on the same calendar day. */
export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/**
 * Add months, clamping the day to the end of the target month.
 *
 * DELIBERATE DEVIATION FROM RFC 5545: the spec says BYMONTHDAY=31 simply skips
 * months with fewer days. For a rent or subscription series that would silently
 * miss February, which is worse than billing on the 28th. So we clamp.
 */
function addMonthsClamped(date: Date, months: number, preferredDay?: number): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = preferredDay ?? date.getUTCDate();

  const target = new Date(Date.UTC(year, month + months, 1));
  const clamped = Math.min(day, daysInMonth(target.getUTCFullYear(), target.getUTCMonth()));

  return new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), clamped));
}

/**
 * The first occurrence strictly after `after`.
 *
 * `start` anchors the series (the template's original date). Returns null when
 * the series has ended via UNTIL, or via COUNT once `occurrencesSoFar` reaches
 * the limit.
 */
export function nextOccurrence(
  rule: RecurrenceRule,
  start: Date,
  after: Date,
  occurrencesSoFar = 0,
): Date | null {
  if (rule.count !== undefined && occurrencesSoFar >= rule.count) return null;

  const anchor = startOfUtcDay(start);
  const cursor = startOfUtcDay(after);
  let candidate: Date;

  switch (rule.freq) {
    case 'DAILY': {
      const elapsed = Math.floor((cursor.getTime() - anchor.getTime()) / DAY_MS);
      // How many whole intervals have passed; step to the next one.
      const steps = elapsed < 0 ? 0 : Math.floor(elapsed / rule.interval) + 1;
      candidate = new Date(anchor.getTime() + steps * rule.interval * DAY_MS);
      break;
    }

    case 'WEEKLY': {
      candidate = nextWeekly(rule, anchor, cursor);
      break;
    }

    case 'MONTHLY': {
      const day = rule.byMonthDay ?? anchor.getUTCDate();
      let months =
        (cursor.getUTCFullYear() - anchor.getUTCFullYear()) * 12 +
        (cursor.getUTCMonth() - anchor.getUTCMonth());
      // Snap to a whole number of intervals from the anchor.
      months = Math.floor(months / rule.interval) * rule.interval;
      candidate = addMonthsClamped(anchor, months, day);
      while (candidate.getTime() <= cursor.getTime()) {
        months += rule.interval;
        candidate = addMonthsClamped(anchor, months, day);
      }
      break;
    }

    case 'YEARLY': {
      let years = cursor.getUTCFullYear() - anchor.getUTCFullYear();
      years = Math.floor(years / rule.interval) * rule.interval;
      candidate = addMonthsClamped(anchor, years * 12, rule.byMonthDay);
      while (candidate.getTime() <= cursor.getTime()) {
        years += rule.interval;
        candidate = addMonthsClamped(anchor, years * 12, rule.byMonthDay);
      }
      break;
    }

    default: {
      const exhaustive: never = rule.freq;
      throw new RecurrenceError(`Unhandled frequency: ${exhaustive}`);
    }
  }

  // An occurrence can never precede the series start.
  if (candidate.getTime() < anchor.getTime()) candidate = anchor;

  if (rule.until && candidate.getTime() > rule.until.getTime()) return null;

  return candidate;
}

function nextWeekly(rule: RecurrenceRule, anchor: Date, cursor: Date): Date {
  const weekdays = (rule.byDay?.length
    ? rule.byDay.map((d) => WEEKDAYS.indexOf(d))
    : [anchor.getUTCDay()]
  ).sort((a, b) => a - b);

  // Start of the anchor's week (Sunday-based, matching WEEKDAYS).
  const anchorWeekStart = new Date(anchor.getTime() - anchor.getUTCDay() * DAY_MS);

  let probe = new Date(cursor.getTime() + DAY_MS);
  // Bounded scan: at most interval weeks plus a full week of candidate days.
  const limit = (rule.interval + 1) * 7 + 7;

  for (let i = 0; i < limit; i += 1) {
    const weeksFromAnchor = Math.floor(
      (probe.getTime() - anchorWeekStart.getTime()) / (7 * DAY_MS),
    );
    if (
      weeksFromAnchor >= 0 &&
      weeksFromAnchor % rule.interval === 0 &&
      weekdays.includes(probe.getUTCDay())
    ) {
      return probe;
    }
    probe = new Date(probe.getTime() + DAY_MS);
  }

  throw new RecurrenceError('Could not find a next weekly occurrence within the scan window');
}

/**
 * All occurrences in (after, through]. Used by the generator to catch up when
 * the job has not run for a while — a server down for a week must still
 * produce the rent that fell due, exactly once each.
 */
export function occurrencesBetween(
  rule: RecurrenceRule,
  start: Date,
  after: Date,
  through: Date,
  occurrencesSoFar = 0,
  maxResults = 120,
): Date[] {
  const results: Date[] = [];
  let cursor = after;
  let seen = occurrencesSoFar;

  while (results.length < maxResults) {
    const next = nextOccurrence(rule, start, cursor, seen);
    if (!next || next.getTime() > startOfUtcDay(through).getTime()) break;
    results.push(next);
    cursor = next;
    seen += 1;
  }

  return results;
}
