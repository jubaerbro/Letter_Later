import type { Season, TreeStyle } from '@shared/domain/growth.ts';

export interface TreeColors {
  leaf: string;
  leafLight: string;
  leafDark: string;
  trunk: string;
  trunkDark: string;
  blossom: string;
  glow?: string;
}

const STYLES: Record<TreeStyle, TreeColors & { label: string; premium?: boolean }> = {
  oak: { label: 'Oak', leaf: '#7FA86A', leafLight: '#A6C98D', leafDark: '#5E8A4F', trunk: '#8B6A4E', trunkDark: '#6E523B', blossom: '#E9C46A' },
  cherry: { label: 'Cherry', leaf: '#F1B3C2', leafLight: '#F9D5DE', leafDark: '#DE90A5', trunk: '#7A5646', trunkDark: '#5E4136', blossom: '#FFFFFF' },
  willow: { label: 'Willow', leaf: '#8DB27A', leafLight: '#B6D3A0', leafDark: '#6C935D', trunk: '#857055', trunkDark: '#6A5843', blossom: '#F3E9A6' },
  maple: { label: 'Maple', leaf: '#E3864E', leafLight: '#F1AA78', leafDark: '#C66A38', trunk: '#7C5A44', trunkDark: '#604535', blossom: '#F7D06B' },
  birch: { label: 'Birch', leaf: '#B5CF7E', leafLight: '#D4E6A4', leafDark: '#93B462', trunk: '#F1EDE4', trunkDark: '#3E3A36', blossom: '#FFF6C9' },
  lantern: { label: 'Lantern', premium: true, leaf: '#4F7A63', leafLight: '#6E9C82', leafDark: '#3B5F4C', trunk: '#6C5444', trunkDark: '#523F33', blossom: '#FFC86B', glow: '#FFDFA0' },
  starlight: { label: 'Starlight', premium: true, leaf: '#5B6FA8', leafLight: '#8296CB', leafDark: '#45578A', trunk: '#5E5068', trunkDark: '#463B4F', blossom: '#FFF1B8', glow: '#FFF8DA' },
};

export function styleInfo(style: string) {
  return STYLES[(style in STYLES ? style : 'oak') as TreeStyle];
}

function hexToRgb(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function mix(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  const c = (x: number, y: number) => Math.round(x + (y - x) * t).toString(16).padStart(2, '0');
  return `#${c(r1, r2)}${c(g1, g2)}${c(b1, b2)}`;
}

/** Seasons tint the everyday styles; the magical ones keep their colours. */
export function treeColors(style: string, season: Season): TreeColors {
  const base = styleInfo(style);
  const magical = base.premium;
  if (magical || season === 'summer') return base;
  if (season === 'autumn' && style !== 'maple') {
    return { ...base, leaf: mix(base.leaf, '#D98A48', 0.45), leafLight: mix(base.leafLight, '#EDB27A', 0.45), leafDark: mix(base.leafDark, '#B8693A', 0.45) };
  }
  if (season === 'winter') {
    return { ...base, leaf: mix(base.leaf, '#9FB0A8', 0.35), leafLight: mix(base.leafLight, '#E8EEEA', 0.4), leafDark: mix(base.leafDark, '#7E8F88', 0.35) };
  }
  if (season === 'spring') {
    return { ...base, leaf: mix(base.leaf, '#9ED07F', 0.2), leafLight: mix(base.leafLight, '#C9EBAE', 0.25) };
  }
  return base;
}

export function groundColor(season: Season, dark: boolean): { top: string; bottom: string } {
  if (season === 'winter') return { top: dark ? '#DCE3E6' : '#FFFFFF', bottom: dark ? '#9BA8AE' : '#E3E9EC' };
  if (season === 'autumn') return { top: dark ? '#6F6A44' : '#B9B07A', bottom: dark ? '#4E4A30' : '#988E5B' };
  return { top: dark ? '#4F6E47' : '#A9C98E', bottom: dark ? '#3A5435' : '#86AB6E' };
}

export const ALL_STYLES = Object.keys(STYLES) as TreeStyle[];
