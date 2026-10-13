import * as Localization from 'expo-localization';
import { formatInZone, isValidTimeZone, timeZoneLabel } from '@shared/domain/time.ts';

export function deviceTimeZone(): string {
  const tz = Localization.getCalendars()[0]?.timeZone;
  return tz && isValidTimeZone(tz) ? tz : 'UTC';
}

export function deviceHemisphere(): 'north' | 'south' {
  const region = Localization.getLocales()[0]?.regionCode ?? '';
  return ['AU', 'NZ', 'ZA', 'AR', 'CL', 'UY', 'PY', 'BR', 'PE', 'BO', 'MG', 'MZ', 'ZW', 'NA', 'BW', 'LS', 'SZ', 'FJ'].includes(region)
    ? 'south'
    : 'north';
}

/** "Saturday, 1 June 2031 at 09:00 (BST)" in the viewer's zone. */
export function formatDateTime(iso: string | Date, timeZone: string = deviceTimeZone()): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return `${formatInZone(d, timeZone, { dateStyle: 'full', timeStyle: 'short' })} (${timeZoneLabel(timeZone, d)})`;
}

export function formatDate(iso: string | Date, timeZone: string = deviceTimeZone()): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return formatInZone(d, timeZone, { dateStyle: 'medium' });
}

export function relativeDay(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return formatDate(iso);
}
