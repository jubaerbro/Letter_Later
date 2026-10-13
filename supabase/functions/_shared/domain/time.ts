/**
 * Time-zone safe conversions built only on Intl (works in Hermes, Deno and Node).
 *
 * The app lets people pick a wall-clock time ("9:00 on 1 June 2031 in Europe/London").
 * We convert that to a single UTC instant, which is what the server stores and what the
 * scheduler compares against. Daylight-saving edge cases are handled explicitly:
 *  - a wall time that does not exist (spring-forward gap) is moved forward by the gap and
 *    reported as `shifted_forward`, so the UI can tell the sender;
 *  - a wall time that occurs twice (fall-back overlap) resolves to the earlier instant and
 *    is reported as `ambiguous`.
 */

export interface WallTime {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number; // 0-23
  minute: number;
  second?: number;
}

export type Resolution = 'exact' | 'shifted_forward' | 'ambiguous';

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

export function isValidTimeZone(timeZone: string | null | undefined): timeZone is string {
  if (!timeZone || timeZone.length > 64) return false;
  try {
    formatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** The wall-clock reading of `instant` in `timeZone`. */
export function wallTimeOf(instant: Date, timeZone: string): Required<WallTime> {
  const parts = formatter(timeZone).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour') % 24,
    minute: get('minute'),
    second: get('second'),
  };
}

/** UTC offset of `timeZone` at `instant`, in minutes (e.g. +60 for BST). */
export function offsetMinutes(instant: Date, timeZone: string): number {
  const w = wallTimeOf(instant, timeZone);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  const truncated = Math.floor(instant.getTime() / 1000) * 1000;
  return Math.round((asUtc - truncated) / 60_000);
}

function sameWall(a: WallTime, b: WallTime) {
  return a.year === b.year && a.month === b.month && a.day === b.day && a.hour === b.hour && a.minute === b.minute;
}

export function isValidWallTime(w: WallTime): boolean {
  if (![w.year, w.month, w.day, w.hour, w.minute].every(Number.isInteger)) return false;
  if (w.month < 1 || w.month > 12 || w.hour < 0 || w.hour > 23 || w.minute < 0 || w.minute > 59) return false;
  const daysInMonth = new Date(Date.UTC(w.year, w.month, 0)).getUTCDate();
  return w.day >= 1 && w.day <= daysInMonth;
}

/** Convert a wall-clock time in a zone to the UTC instant that will be stored. */
export function wallTimeToInstant(w: WallTime, timeZone: string): { instant: Date; resolution: Resolution } {
  if (!isValidWallTime(w)) throw new RangeError('invalid_wall_time');
  if (!isValidTimeZone(timeZone)) throw new RangeError('invalid_time_zone');
  const naive = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second ?? 0);
  const before = offsetMinutes(new Date(naive - 86_400_000), timeZone);
  const after = offsetMinutes(new Date(naive + 86_400_000), timeZone);
  const candidates = [...new Set([before, after])]
    .map((o) => naive - o * 60_000)
    .filter((t) => sameWall(wallTimeOf(new Date(t), timeZone), w))
    .sort((a, b) => a - b);

  if (candidates.length === 0) {
    // In a spring-forward gap: keep the pre-transition offset, which lands after the gap.
    return { instant: new Date(naive - before * 60_000), resolution: 'shifted_forward' };
  }
  return { instant: new Date(candidates[0]), resolution: candidates.length > 1 ? 'ambiguous' : 'exact' };
}

export function formatInZone(
  instant: Date,
  timeZone: string,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'full', timeStyle: 'short' },
  locale?: string,
): string {
  return new Intl.DateTimeFormat(locale, { ...options, timeZone }).format(instant);
}

export function timeZoneLabel(timeZone: string, instant: Date, locale?: string): string {
  try {
    const parts = new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: 'short' }).formatToParts(instant);
    return parts.find((p) => p.type === 'timeZoneName')?.value ?? timeZone;
  } catch {
    return timeZone;
  }
}

export type ScheduleProblem = 'too_soon' | 'too_far' | 'invalid';

export function validateDeliveryInstant(
  instant: Date,
  now: Date,
  opts: { minLeadSeconds: number; maxYears: number },
): ScheduleProblem | null {
  if (Number.isNaN(instant.getTime())) return 'invalid';
  if (instant.getTime() < now.getTime() + opts.minLeadSeconds * 1000) return 'too_soon';
  const max = new Date(now.getTime());
  max.setUTCFullYear(max.getUTCFullYear() + opts.maxYears);
  if (instant.getTime() > max.getTime()) return 'too_far';
  return null;
}

export interface Countdown {
  done: boolean;
  totalMs: number;
  years: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

function addUtcYears(d: Date, years: number): Date {
  const r = new Date(d.getTime());
  r.setUTCFullYear(r.getUTCFullYear() + years);
  return r;
}

/** Calendar-aware countdown (whole years first, then days/hours/minutes/seconds). */
export function countdown(target: Date, now: Date): Countdown {
  const totalMs = target.getTime() - now.getTime();
  if (totalMs <= 0) return { done: true, totalMs: 0, years: 0, days: 0, hours: 0, minutes: 0, seconds: 0 };
  let years = 0;
  while (addUtcYears(now, years + 1).getTime() <= target.getTime()) years++;
  let rest = target.getTime() - addUtcYears(now, years).getTime();
  const days = Math.floor(rest / 86_400_000);
  rest -= days * 86_400_000;
  const hours = Math.floor(rest / 3_600_000);
  rest -= hours * 3_600_000;
  const minutes = Math.floor(rest / 60_000);
  rest -= minutes * 60_000;
  return { done: false, totalMs, years, days, hours, minutes, seconds: Math.floor(rest / 1000) };
}

/** A short, gentle phrase: "in 2 years, 41 days", "in 3 hours", "any moment now". */
export function describeCountdown(c: Countdown): string {
  if (c.done) return 'ready to open';
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
  if (c.years > 0) return `in ${plural(c.years, 'year')}${c.days ? `, ${plural(c.days, 'day')}` : ''}`;
  if (c.days > 0) return `in ${plural(c.days, 'day')}${c.days < 7 && c.hours ? `, ${plural(c.hours, 'hour')}` : ''}`;
  if (c.hours > 0) return `in ${plural(c.hours, 'hour')}${c.minutes ? `, ${plural(c.minutes, 'minute')}` : ''}`;
  if (c.minutes > 0) return `in ${plural(c.minutes, 'minute')}`;
  return 'any moment now';
}
