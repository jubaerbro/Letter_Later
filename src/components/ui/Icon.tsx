import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { useTheme } from '@/theme/ThemeProvider';

export type IconName =
  | 'garden' | 'mailbox' | 'music' | 'settings' | 'plus' | 'close' | 'back' | 'chevron' | 'play' | 'pause'
  | 'water' | 'sun' | 'heart' | 'search' | 'bell' | 'lock' | 'trash' | 'flag' | 'shield' | 'sparkle'
  | 'volume' | 'check' | 'clock' | 'calendar' | 'file' | 'next' | 'prev' | 'pen' | 'eye' | 'eyeOff' | 'user';

/** Hand-drawn-feeling stroke icons on a 24px grid. */
const PATHS: Record<IconName, string[]> = {
  garden: ['M12 21v-7', 'M12 14c-4 0-7-3-7-7 4 0 7 3 7 7z', 'M12 12c0-4 3-7 7-7 0 4-3 7-7 7z', 'M6 21h12'],
  mailbox: ['M3 7.5A2.5 2.5 0 0 1 5.5 5h13A2.5 2.5 0 0 1 21 7.5v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 16.5z', 'M4 7l8 6 8-6'],
  music: ['M9 18V6l11-2v12', 'M9 18a3 3 0 1 1-3-3 3 3 0 0 1 3 3z', 'M20 16a3 3 0 1 1-3-3 3 3 0 0 1 3 3z'],
  settings: ['M4 7h10', 'M18 7h2', 'M4 17h4', 'M12 17h8', 'M16 5v4', 'M10 15v4'],
  plus: ['M12 5v14', 'M5 12h14'],
  close: ['M6 6l12 12', 'M18 6L6 18'],
  back: ['M15 5l-7 7 7 7'],
  chevron: ['M9 5l7 7-7 7'],
  play: ['M8 5.5v13a1 1 0 0 0 1.5.86l10-6.5a1 1 0 0 0 0-1.72l-10-6.5A1 1 0 0 0 8 5.5z'],
  pause: ['M8 5v14', 'M16 5v14'],
  water: ['M12 3.5c3 4 6 7.2 6 10.5a6 6 0 0 1-12 0c0-3.3 3-6.5 6-10.5z', 'M9.5 14.5a2.5 2.5 0 0 0 2.5 2.5'],
  sun: ['M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M12 2.5v2', 'M12 19.5v2', 'M2.5 12h2', 'M19.5 12h2', 'M5.3 5.3l1.4 1.4', 'M17.3 17.3l1.4 1.4', 'M5.3 18.7l1.4-1.4', 'M17.3 6.7l1.4-1.4'],
  heart: ['M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z'],
  search: ['M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z', 'M20 20l-4-4'],
  bell: ['M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z', 'M10 20.5a2 2 0 0 0 4 0'],
  lock: ['M6.5 10.5h11a1.5 1.5 0 0 1 1.5 1.5v7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19v-7a1.5 1.5 0 0 1 1.5-1.5z', 'M8 10.5V8a4 4 0 0 1 8 0v2.5'],
  trash: ['M4 7h16', 'M9 7V4.5h6V7', 'M6.5 7l1 13h9l1-13'],
  flag: ['M5 21V4', 'M5 4h11l-2 4 2 4H5'],
  shield: ['M12 3l7 3v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6z'],
  sparkle: ['M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z', 'M19 16l.7 1.8 1.8.7-1.8.7L19 21l-.7-1.8-1.8-.7 1.8-.7z'],
  volume: ['M4 9.5h3.5L12 5.5v13l-4.5-4H4z', 'M15.5 9a4 4 0 0 1 0 6', 'M18 6.5a7.5 7.5 0 0 1 0 11'],
  check: ['M5 12.5l4.5 4.5L19 7'],
  clock: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 7v5l3.5 2'],
  calendar: ['M5 6h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z', 'M4 10h16', 'M8 3.5V7', 'M16 3.5V7'],
  file: ['M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z', 'M14 3v5h5'],
  next: ['M6 5l9 7-9 7z', 'M18 5v14'],
  prev: ['M18 5l-9 7 9 7z', 'M6 5v14'],
  pen: ['M4 20l1-4L16.5 4.5a2 2 0 0 1 3 3L8 19z', 'M14.5 6.5l3 3'],
  eye: ['M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'],
  eyeOff: ['M3 3l18 18', 'M10.6 6A9.7 9.7 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-2.9 3.6', 'M6.3 7.6A16 16 0 0 0 2.5 12S6 18.5 12 18.5a9.5 9.5 0 0 0 4.3-1'],
  user: ['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M4.5 20.5a7.5 7.5 0 0 1 15 0'],
};

const FILLED: Partial<Record<IconName, true>> = { play: true };

export function Icon({ name, size = 22, color, strokeWidth = 1.8 }: { name: IconName; size?: number; color?: string; strokeWidth?: number }) {
  const { colors } = useTheme();
  const c = color ?? colors.ink;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden importantForAccessibility="no">
      {PATHS[name].map((d, i) => (
        <Path
          key={i}
          d={d}
          stroke={c}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill={FILLED[name] ? c : 'none'}
        />
      ))}
    </Svg>
  );
}

/** Small circular badge used in lists. */
export function IconBadge({ name, tint, background, size = 40 }: { name: IconName; tint?: string; background?: string; size?: number }) {
  const { colors } = useTheme();
  return (
    <Svg width={size} height={size} viewBox="0 0 40 40" accessibilityElementsHidden importantForAccessibility="no">
      <Circle cx={20} cy={20} r={20} fill={background ?? colors.primarySoft} />
      <Rect x={9} y={9} width={22} height={22} fill="transparent" />
      {PATHS[name].map((d, i) => (
        <Path
          key={i}
          d={d}
          transform="translate(8 8)"
          stroke={tint ?? colors.primary}
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill={FILLED[name] ? (tint ?? colors.primary) : 'none'}
        />
      ))}
    </Svg>
  );
}
