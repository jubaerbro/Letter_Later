import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop, Text as SvgText } from 'react-native-svg';
import { useTheme } from '@/theme/ThemeProvider';

/** A sealed envelope with a wax seal. `open` lifts the flap and shows the paper. */
export function Envelope({ width = 260, open = false, initial }: { width?: number; open?: boolean; initial?: string }) {
  const { colors } = useTheme();
  const h = width * 0.66;
  return (
    <Svg width={width} height={h + (open ? width * 0.2 : 0)} viewBox={`0 ${open ? -52 : 0} 300 ${open ? 250 : 198}`} accessibilityElementsHidden importantForAccessibility="no">
      <Defs>
        <LinearGradient id="env" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#F8EBD3" />
          <Stop offset="1" stopColor="#EED9B7" />
        </LinearGradient>
        <LinearGradient id="flap" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#F2DFBF" />
          <Stop offset="1" stopColor="#E6CDA4" />
        </LinearGradient>
      </Defs>
      {open && (
        <>
          <Path d="M20 30 L150 -50 L280 30 Z" fill="url(#flap)" stroke="#D9C29B" strokeWidth={1.5} />
          <Rect x={42} y={-30} width={216} height={150} rx={6} fill={colors.paper} stroke="#E4D6BC" />
          {[0, 1, 2, 3].map((i) => (
            <Rect key={i} x={62} y={-6 + i * 20} width={i === 3 ? 110 : 176} height={4} rx={2} fill="#E5DAC5" />
          ))}
        </>
      )}
      <Rect x={20} y={30} width={260} height={160} rx={14} fill="url(#env)" stroke="#D9C29B" strokeWidth={1.5} />
      <Path d="M20 186 L150 100 L280 186" fill="none" stroke="#D9C29B" strokeWidth={1.5} />
      {!open && <Path d="M22 34 L150 122 L278 34" fill="url(#flap)" stroke="#D9C29B" strokeWidth={1.5} strokeLinejoin="round" />}
      {!open && (
        <>
          <Circle cx={150} cy={120} r={23} fill={colors.seal} />
          <Circle cx={150} cy={120} r={17} fill="none" stroke="#FFFFFF" strokeOpacity={0.35} strokeWidth={1.5} />
          <SvgText x={150} y={127} fontSize={19} fontWeight="bold" fill="#FFF3E6" textAnchor="middle">
            {(initial ?? '✿').slice(0, 1).toUpperCase()}
          </SvgText>
        </>
      )}
    </Svg>
  );
}
