import { describe, expect, it } from 'vitest';
import { palette } from '../../src/theme/tokens';

function luminance(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const ratio = (a: string, b: string) => {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
};

describe('WCAG AA text contrast', () => {
  for (const scheme of ['light', 'dark'] as const) {
    const c = palette[scheme];
    for (const bg of ['background', 'surface', 'surfaceSunken'] as const) {
      for (const fg of ['ink', 'inkSoft', 'muted'] as const) {
        it(`${scheme}: ${fg} on ${bg} ≥ 4.5`, () => expect(ratio(c[fg], c[bg])).toBeGreaterThanOrEqual(4.5));
      }
    }
    it(`${scheme}: button label on primary ≥ 4.5`, () => expect(ratio(c.onPrimary, c.primary)).toBeGreaterThanOrEqual(4.5));
    it(`${scheme}: primary text on background ≥ 4.5`, () => expect(ratio(c.primary, c.background)).toBeGreaterThanOrEqual(4.5));
    it(`${scheme}: danger text on dangerSoft ≥ 4.5`, () => expect(ratio(c.danger, c.dangerSoft)).toBeGreaterThanOrEqual(4.5));
    it(`${scheme}: ink on primarySoft ≥ 4.5`, () => expect(ratio(c.ink, c.primarySoft)).toBeGreaterThanOrEqual(4.5));
  }
  it('letter paper text is readable in both schemes', () => {
    expect(ratio('#2C3829', palette.light.paper)).toBeGreaterThanOrEqual(7);
    expect(ratio('#2C3829', palette.dark.paper)).toBeGreaterThanOrEqual(7);
  });
});
