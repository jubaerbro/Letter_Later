import { describe, expect, it } from 'vitest';
import {
  countdown,
  describeCountdown,
  formatInZone,
  isValidTimeZone,
  isValidWallTime,
  offsetMinutes,
  validateDeliveryInstant,
  wallTimeToInstant,
} from '@shared/domain/time';

describe('wall time → UTC instant', () => {
  it('converts an ordinary time in several zones', () => {
    expect(wallTimeToInstant({ year: 2031, month: 6, day: 1, hour: 9, minute: 0 }, 'Europe/London').instant.toISOString()).toBe(
      '2031-06-01T08:00:00.000Z',
    );
    expect(wallTimeToInstant({ year: 2031, month: 1, day: 1, hour: 9, minute: 0 }, 'Europe/London').instant.toISOString()).toBe(
      '2031-01-01T09:00:00.000Z',
    );
    expect(wallTimeToInstant({ year: 2030, month: 12, day: 25, hour: 7, minute: 30 }, 'Asia/Kolkata').instant.toISOString()).toBe(
      '2030-12-25T02:00:00.000Z',
    );
    expect(wallTimeToInstant({ year: 2030, month: 3, day: 1, hour: 0, minute: 0 }, 'America/Los_Angeles').instant.toISOString()).toBe(
      '2030-03-01T08:00:00.000Z',
    );
  });

  it('handles the spring-forward gap by moving forward (London, 30 Mar 2031 01:30 does not exist)', () => {
    const r = wallTimeToInstant({ year: 2031, month: 3, day: 30, hour: 1, minute: 30 }, 'Europe/London');
    expect(r.resolution).toBe('shifted_forward');
    expect(r.instant.toISOString()).toBe('2031-03-30T01:30:00.000Z'); // shown as 02:30 BST
  });

  it('handles the US spring-forward gap (New York, 9 Mar 2031 02:15)', () => {
    const r = wallTimeToInstant({ year: 2031, month: 3, day: 9, hour: 2, minute: 15 }, 'America/New_York');
    expect(r.resolution).toBe('shifted_forward');
    expect(r.instant.toISOString()).toBe('2031-03-09T07:15:00.000Z'); // 03:15 EDT
  });

  it('resolves the fall-back overlap to the earlier instant and flags it', () => {
    const r = wallTimeToInstant({ year: 2031, month: 10, day: 26, hour: 1, minute: 30 }, 'Europe/London');
    expect(r.resolution).toBe('ambiguous');
    expect(r.instant.toISOString()).toBe('2031-10-26T00:30:00.000Z'); // 01:30 BST, the first one
  });

  it('works for zones without DST and with half-hour offsets', () => {
    expect(wallTimeToInstant({ year: 2040, month: 7, day: 4, hour: 12, minute: 0 }, 'Asia/Tokyo').resolution).toBe('exact');
    expect(wallTimeToInstant({ year: 2040, month: 1, day: 1, hour: 0, minute: 0 }, 'Australia/Adelaide').instant.toISOString()).toBe(
      '2039-12-31T13:30:00.000Z',
    );
  });

  it('rejects impossible dates and unknown zones', () => {
    expect(isValidWallTime({ year: 2031, month: 2, day: 29, hour: 0, minute: 0 })).toBe(false);
    expect(isValidWallTime({ year: 2032, month: 2, day: 29, hour: 0, minute: 0 })).toBe(true);
    expect(() => wallTimeToInstant({ year: 2031, month: 2, day: 30, hour: 0, minute: 0 }, 'UTC')).toThrow('invalid_wall_time');
    expect(() => wallTimeToInstant({ year: 2031, month: 2, day: 1, hour: 0, minute: 0 }, 'Mars/Base')).toThrow('invalid_time_zone');
    expect(isValidTimeZone('Europe/Paris')).toBe(true);
    expect(isValidTimeZone('Nope/Nowhere')).toBe(false);
  });

  it('round-trips: the stored instant reads back as the chosen wall time', () => {
    const zones = ['Europe/London', 'America/Sao_Paulo', 'Asia/Kathmandu', 'Pacific/Auckland', 'Africa/Cairo'];
    for (const tz of zones) {
      for (let month = 1; month <= 12; month++) {
        const w = { year: 2035, month, day: 15, hour: 18, minute: 45 };
        const { instant, resolution } = wallTimeToInstant(w, tz);
        expect(resolution).toBe('exact');
        const formatted = formatInZone(instant, tz, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }, 'en-GB');
        expect(formatted).toBe('18:45');
      }
    }
  });

  it('reports UTC offsets including DST', () => {
    expect(offsetMinutes(new Date('2031-07-01T12:00:00Z'), 'Europe/London')).toBe(60);
    expect(offsetMinutes(new Date('2031-01-01T12:00:00Z'), 'Europe/London')).toBe(0);
    expect(offsetMinutes(new Date('2031-01-01T12:00:00Z'), 'Asia/Kathmandu')).toBe(345);
  });
});

describe('delivery validation', () => {
  const now = new Date('2026-10-13T10:00:00Z');
  const opts = { minLeadSeconds: 3600, maxYears: 50 };
  it('requires the minimum lead time', () => {
    expect(validateDeliveryInstant(new Date('2026-10-13T10:30:00Z'), now, opts)).toBe('too_soon');
    expect(validateDeliveryInstant(new Date('2026-10-13T11:00:00Z'), now, opts)).toBeNull();
  });
  it('allows decades ahead but not beyond the maximum', () => {
    expect(validateDeliveryInstant(new Date('2066-10-13T09:00:00Z'), now, opts)).toBeNull();
    expect(validateDeliveryInstant(new Date('2076-10-13T11:00:00Z'), now, opts)).toBe('too_far');
  });
  it('rejects invalid dates', () => {
    expect(validateDeliveryInstant(new Date('nope'), now, opts)).toBe('invalid');
  });
});

describe('countdown', () => {
  it('counts whole calendar years, then days', () => {
    const c = countdown(new Date('2029-12-25T09:00:00Z'), new Date('2026-10-13T09:00:00Z'));
    expect(c).toMatchObject({ done: false, years: 3, days: 73, hours: 0, minutes: 0 });
    expect(describeCountdown(c)).toBe('in 3 years, 73 days');
  });
  it('shows hours and minutes when close', () => {
    const c = countdown(new Date('2026-10-13T12:30:00Z'), new Date('2026-10-13T09:00:00Z'));
    expect(describeCountdown(c)).toBe('in 3 hours, 30 minutes');
  });
  it('is done at or after the moment', () => {
    expect(countdown(new Date('2026-10-13T09:00:00Z'), new Date('2026-10-13T09:00:00Z')).done).toBe(true);
    expect(describeCountdown(countdown(new Date(0), new Date()))).toBe('ready to open');
  });
  it('handles leap days', () => {
    const c = countdown(new Date('2032-02-29T00:00:00Z'), new Date('2028-02-29T00:00:00Z'));
    expect(c.years).toBe(4);
    expect(c.days).toBe(0);
  });
});
