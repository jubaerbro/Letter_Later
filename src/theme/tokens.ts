/**
 * Letter Later design tokens.
 *
 * Mood: warm paper, soft sage, dawn peach and a little gold — like a letter kept in a
 * wooden box in a garden. Dark mode is a quiet night orchard, not pure black.
 * Text colours meet WCAG AA (≥ 4.5:1) on their intended backgrounds.
 */
type Gradient = readonly [string, string, ...string[]];

const light = {
  background: '#F7F1E6',
  backgroundAlt: '#F1E8D8',
  surface: '#FFFCF6',
  surfaceSunken: '#EFE6D5',
  border: '#E4D8C3',
  ink: '#2C3829', // 12.6:1 on background
  inkSoft: '#56634F', // 5.9:1
  muted: '#6B6558', // ≥4.6:1 on every light surface
  primary: '#4E7245',
  primaryPressed: '#41613A',
  onPrimary: '#FFFFFF',
  primarySoft: '#DFE9D6',
  accent: '#D98E5F', // apricot (decorative)
  accentSoft: '#F7DFCC',
  gold: '#C9952F',
  goldSoft: '#F5E6C2',
  sky: '#A8C6DA',
  rose: '#E7A9A3',
  danger: '#A6463B',
  dangerSoft: '#F6DCD7',
  success: '#4F7F48',
  paper: '#FFFDF7',
  paperLine: '#EADFCB',
  seal: '#A8443B',
  shadow: 'rgba(84, 66, 38, 0.12)',
  overlay: 'rgba(44, 56, 41, 0.35)',
  dawn: ['#FBEEDD', '#F6E2D4', '#EEE3EF'] as Gradient,
  meadow: ['#EAF0DC', '#F7F1E6'] as Gradient,
};

export type Colors = typeof light;

const dark: Colors = {
  background: '#141A16',
  backgroundAlt: '#18201B',
  surface: '#1D2621',
  surfaceSunken: '#111613',
  border: '#2D3A32',
  ink: '#F0E9DB',
  inkSoft: '#C8C0AE',
  muted: '#A39D8E',
  primary: '#9CC08C',
  primaryPressed: '#B2D2A3',
  onPrimary: '#122012',
  primarySoft: '#26352A',
  accent: '#E6A97F',
  accentSoft: '#3A2C22',
  gold: '#E6C46A',
  goldSoft: '#3A3220',
  sky: '#6E8FA6',
  rose: '#C98C87',
  danger: '#E58C80',
  dangerSoft: '#3A221F',
  success: '#9CC08C',
  paper: '#F6EFE1',
  paperLine: '#E2D6C0',
  seal: '#B9534A',
  shadow: 'rgba(0, 0, 0, 0.4)',
  overlay: 'rgba(5, 8, 6, 0.6)',
  dawn: ['#18231E', '#1B2128', '#211D2A'],
  meadow: ['#1A241E', '#141A16'],
};

export const palette = { light, dark };

export const space = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 } as const;
export const radius = { sm: 10, md: 16, lg: 22, xl: 28, pill: 999 } as const;

export const fonts = {
  display: 'Fraunces_600SemiBold',
  displayRegular: 'Fraunces_400Regular',
  displayItalic: 'Fraunces_400Regular_Italic',
  body: 'Nunito_400Regular',
  bodyMedium: 'Nunito_600SemiBold',
  bodyBold: 'Nunito_700Bold',
} as const;

export const type = {
  hero: { fontFamily: fonts.display, fontSize: 34, lineHeight: 40, letterSpacing: -0.3 },
  title: { fontFamily: fonts.display, fontSize: 26, lineHeight: 32, letterSpacing: -0.2 },
  heading: { fontFamily: fonts.display, fontSize: 20, lineHeight: 26 },
  body: { fontFamily: fonts.body, fontSize: 16, lineHeight: 24 },
  bodyStrong: { fontFamily: fonts.bodyMedium, fontSize: 16, lineHeight: 24 },
  small: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20 },
  caption: { fontFamily: fonts.bodyMedium, fontSize: 12, lineHeight: 16, letterSpacing: 0.4 },
  letter: { fontFamily: fonts.displayRegular, fontSize: 18, lineHeight: 30 },
  number: { fontFamily: fonts.display, fontSize: 30, lineHeight: 34 },
} as const;

export type TypeVariant = keyof typeof type;

export const motion = {
  quick: 180,
  gentle: 320,
  slow: 600,
  breath: 4000,
} as const;
