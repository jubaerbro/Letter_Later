import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const md = readFileSync(new URL('../../store/listing.md', import.meta.url), 'utf8');
const section = (title: string) => {
  const start = md.indexOf(`## ${title}`);
  const body = md.slice(md.indexOf('\n', start) + 1);
  return body.slice(0, body.search(/\n## /) === -1 ? undefined : body.search(/\n## /)).trim();
};

describe('Play Store listing respects Google Play limits', () => {
  it('app name ≤ 30', () => expect(section('App name (≤ 30)').length).toBeLessThanOrEqual(30));
  it('short description ≤ 80', () => expect(section('Short description (≤ 80)').length).toBeLessThanOrEqual(80));
  it('full description ≤ 4000', () => expect(section('Full description (≤ 4000)').length).toBeLessThanOrEqual(4000));
  it('release notes ≤ 500', () => expect(section('Release notes (first release)').length).toBeLessThanOrEqual(500));
});
