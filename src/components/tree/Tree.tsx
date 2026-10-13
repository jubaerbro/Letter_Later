import { useEffect, useMemo } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Defs, Ellipse, G, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { STAGE_LABELS, stageProgress, type Season, type TreeStage } from '@shared/domain/growth.ts';
import { useTheme } from '@/theme/ThemeProvider';
import { groundColor, styleInfo, treeColors, type TreeColors } from './palette';

export interface TreeProps {
  stage: TreeStage;
  growth: number; // 0..1 overall visual growth
  style?: string;
  season?: Season;
  size?: number;
  /** Increment to play a small "thank you" bounce after nurturing. */
  pulseKey?: number;
  sway?: boolean;
  label?: string;
  containerStyle?: StyleProp<ViewStyle>;
  /** Soft sunrise behind the tree, for illustrations where small stages would look lost. */
  halo?: boolean;
  /** Crop the frame to the current stage so small stages stay visible in thumbnails. */
  fit?: boolean;
}

/** Frames per stage for `fit` (same 200:220 aspect as the full scene). */
const FIT_VIEWBOX: Record<TreeStage, string> = {
  seed: '59 130 82 90',
  sprout: '50 110 100 110',
  sapling: '27 60 146 160',
  young: '0 0 200 220',
  mature: '0 0 200 220',
  bloom: '0 0 200 220',
};

/** Canopy layout per stage: [dx, dy, r] relative to the crown centre. Hand-tuned for charm. */
const CANOPY: Record<'sapling' | 'young' | 'mature', [number, number, number][]> = {
  sapling: [[0, 0, 17], [-13, 7, 12], [13, 6, 12]],
  young: [[0, -6, 24], [-22, 6, 19], [22, 5, 19], [-10, 16, 17], [12, 17, 17]],
  mature: [[0, -14, 30], [-28, -2, 24], [28, -3, 24], [-38, 18, 19], [38, 17, 19], [-14, 20, 24], [16, 21, 24]],
};

/** Deterministic pseudo-random so a tree looks the same every render. */
function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

function Trunk({ height, width, c, style }: { height: number; width: number; c: TreeColors; style: string }) {
  const top = 196 - height;
  const d = `M${100 - width / 2} 196 C ${100 - width / 2} ${top + height * 0.4}, ${100 - width * 0.3} ${top + 6}, 100 ${top} C ${100 + width * 0.3} ${top + 6}, ${100 + width / 2} ${top + height * 0.4}, ${100 + width / 2} 196 Z`;
  return (
    <G>
      <Path d={d} fill={c.trunk} />
      {width > 6 && (
        <>
          <Path d={`M100 ${top + height * 0.45} q -${width * 1.4} -8 -${width * 2.2} -${height * 0.22}`} stroke={c.trunk} strokeWidth={width * 0.45} strokeLinecap="round" fill="none" />
          <Path d={`M100 ${top + height * 0.6} q ${width * 1.3} -6 ${width * 2.1} -${height * 0.2}`} stroke={c.trunk} strokeWidth={width * 0.4} strokeLinecap="round" fill="none" />
        </>
      )}
      {style === 'birch' &&
        [0.3, 0.5, 0.7, 0.85].map((f, i) => (
          <Rect key={i} x={100 - width / 2 + (i % 2) * width * 0.35} y={top + height * f} width={width * 0.45} height={2} rx={1} fill={c.trunkDark} opacity={0.7} />
        ))}
      <Path d={`M${100 + width * 0.12} ${top + 10} L ${100 + width * 0.18} 192`} stroke={c.trunkDark} strokeWidth={1} opacity={style === 'birch' ? 0 : 0.25} />
    </G>
  );
}

function Canopy({ stage, scale, c, style, season, bloom }: { stage: 'sapling' | 'young' | 'mature'; scale: number; c: TreeColors; style: string; season: Season; bloom: boolean }) {
  const crownY = { sapling: 132, young: 104, mature: 82 }[stage];
  const blobs = CANOPY[stage];
  const rand = seeded(stage.length * 31 + style.length * 7);
  const willow = style === 'willow';
  const showBlossoms = bloom || (season === 'spring' && stage !== 'sapling' && !styleInfo(style).premium) || (styleInfo(style).premium && stage === 'mature');

  return (
    <G transform={`translate(100 ${crownY}) scale(${scale}) translate(-100 -${crownY})`}>
      {/* shadow layer */}
      {blobs.map(([dx, dy, r], i) => (
        <Circle key={`s${i}`} cx={100 + dx} cy={crownY + dy + 4} r={r} fill={c.leafDark} />
      ))}
      {blobs.map(([dx, dy, r], i) => (
        <Circle key={`b${i}`} cx={100 + dx} cy={crownY + dy} r={r} fill={c.leaf} />
      ))}
      {/* soft highlights */}
      {blobs.map(([dx, dy, r], i) => (
        <Circle key={`h${i}`} cx={100 + dx - r * 0.3} cy={crownY + dy - r * 0.35} r={r * 0.45} fill={c.leafLight} opacity={0.75} />
      ))}
      {willow &&
        Array.from({ length: stage === 'mature' ? 11 : 7 }).map((_, i, arr) => {
          const x = 100 - 48 * (stage === 'mature' ? 1 : 0.7) + (i * 96 * (stage === 'mature' ? 1 : 0.7)) / (arr.length - 1);
          const len = 28 + rand() * 30;
          return <Path key={`w${i}`} d={`M${x} ${crownY + 4} q ${(rand() - 0.5) * 10} ${len / 2} ${(rand() - 0.5) * 6} ${len}`} stroke={i % 2 ? c.leafDark : c.leaf} strokeWidth={5} strokeLinecap="round" fill="none" />;
        })}
      {season === 'winter' &&
        blobs.slice(0, 3).map(([dx, dy, r], i) => (
          <Ellipse key={`snow${i}`} cx={100 + dx} cy={crownY + dy - r * 0.78} rx={r * 0.62} ry={r * 0.22} fill="#FFFFFF" opacity={0.92} />
        ))}
      {showBlossoms &&
        Array.from({ length: bloom ? 14 : 7 }).map((_, i) => {
          const [dx, dy, r] = blobs[i % blobs.length];
          const a = rand() * Math.PI * 2;
          const dist = rand() * r * 0.75;
          const x = 100 + dx + Math.cos(a) * dist;
          const y = crownY + dy + Math.sin(a) * dist;
          if (style === 'starlight') {
            return <Path key={`f${i}`} d={`M${x} ${y - 4} L ${x + 1.2} ${y - 1.2} L ${x + 4} ${y} L ${x + 1.2} ${y + 1.2} L ${x} ${y + 4} L ${x - 1.2} ${y + 1.2} L ${x - 4} ${y} L ${x - 1.2} ${y - 1.2} Z`} fill={c.blossom} />;
          }
          if (style === 'lantern') {
            return (
              <G key={`f${i}`}>
                <Circle cx={x} cy={y} r={6} fill={c.glow} opacity={0.35} />
                <Rect x={x - 2.5} y={y - 3} width={5} height={6} rx={2} fill={c.blossom} />
              </G>
            );
          }
          return (
            <G key={`f${i}`}>
              {[0, 72, 144, 216, 288].map((deg) => (
                <Circle key={deg} cx={x + Math.cos((deg * Math.PI) / 180) * 2.2} cy={y + Math.sin((deg * Math.PI) / 180) * 2.2} r={1.8} fill={c.blossom} />
              ))}
              <Circle cx={x} cy={y} r={1.2} fill="#E9B44C" />
            </G>
          );
        })}
    </G>
  );
}

export function Tree({ stage, growth, style = 'oak', season = 'summer', size = 200, pulseKey = 0, sway = true, label, containerStyle, halo, fit }: TreeProps) {
  const { scheme, reduceMotion } = useTheme();
  const c = useMemo(() => treeColors(style, season), [style, season]);
  const ground = groundColor(season, scheme === 'dark');
  const within = stageProgress(growth);
  const bloom = stage === 'bloom';
  const shape: TreeStage = bloom ? 'mature' : stage;

  const rotate = useSharedValue(0);
  const bounce = useSharedValue(1);

  useEffect(() => {
    if (!sway || reduceMotion || shape === 'seed') {
      cancelAnimation(rotate);
      rotate.value = 0;
      return;
    }
    rotate.value = withRepeat(
      withSequence(withTiming(1.4, { duration: 2600, easing: Easing.inOut(Easing.sin) }), withTiming(-1.4, { duration: 2600, easing: Easing.inOut(Easing.sin) })),
      -1,
      true,
    );
    return () => cancelAnimation(rotate);
  }, [sway, reduceMotion, shape, rotate]);

  useEffect(() => {
    if (pulseKey === 0) return;
    bounce.value = reduceMotion ? 1 : withSequence(withTiming(1.05, { duration: 180 }), withTiming(1, { duration: 420, easing: Easing.out(Easing.back(2)) }));
  }, [pulseKey, reduceMotion, bounce]);

  const animated = useAnimatedStyle(() => ({ transform: [{ rotate: `${rotate.value}deg` }, { scale: bounce.value }] }));

  const trunk = { seed: null, sprout: null, sapling: { h: 58 + 10 * within, w: 5 }, young: { h: 92 + 8 * within, w: 9 }, mature: { h: 114, w: 13 }, bloom: null }[shape];
  const canopyScale = 0.86 + 0.14 * (bloom ? 1 : within);
  const a11y = label ?? `${STAGE_LABELS[stage]}, ${styleInfo(style).label} tree`;

  return (
    <View accessible accessibilityRole="image" accessibilityLabel={a11y} style={[{ width: size, height: size * 1.1, alignItems: 'center' }, containerStyle]}>
      <Animated.View style={[{ width: size, height: size * 1.1, transformOrigin: 'bottom' }, animated]}>
        <Svg width={size} height={size * 1.1} viewBox={fit ? FIT_VIEWBOX[shape] : '0 0 200 220'}>
          <Defs>
            <RadialGradient id="halo" cx="50%" cy="50%" r="50%">
              <Stop offset="0%" stopColor={scheme === 'dark' ? '#3B4A3A' : '#FFF4DF'} stopOpacity={1} />
              <Stop offset="70%" stopColor={scheme === 'dark' ? '#2A3529' : '#FBE6CF'} stopOpacity={0.7} />
              <Stop offset="100%" stopColor={scheme === 'dark' ? '#2A3529' : '#FBE6CF'} stopOpacity={0} />
            </RadialGradient>
            <RadialGradient id="glow" cx="50%" cy="45%" r="55%">
              <Stop offset="0%" stopColor={c.glow ?? c.blossom} stopOpacity={bloom ? 0.55 : 0.18} />
              <Stop offset="100%" stopColor={c.glow ?? c.blossom} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          {halo && (
            <G>
              <Circle cx={100} cy={118} r={92} fill="url(#halo)" />
              {[[38, 58, 2.4], [160, 44, 1.8], [150, 112, 2], [52, 128, 1.6], [96, 30, 1.4]].map(([x, y, r], i) => (
                <Circle key={i} cx={x} cy={y} r={r} fill={scheme === 'dark' ? '#E6C46A' : '#E9C46A'} opacity={0.75} />
              ))}
            </G>
          )}
          {(bloom || styleInfo(style).premium) && <Circle cx={100} cy={100} r={96} fill="url(#glow)" />}

          {/* ground */}
          <Ellipse cx={100} cy={200} rx={74} ry={13} fill={ground.bottom} />
          <Ellipse cx={100} cy={196} rx={70} ry={11} fill={ground.top} />

          {shape === 'seed' && (
            <G>
              <Ellipse cx={100} cy={188} rx={11} ry={8} fill={c.trunk} transform="rotate(-18 100 188)" />
              <Ellipse cx={96} cy={185} rx={3.5} ry={2} fill="#FFFFFF" opacity={0.45} transform="rotate(-18 96 185)" />
              {within > 0.5 && <Path d="M101 181 q 2 -6 6 -8" stroke="#8DBF6E" strokeWidth={2.4} strokeLinecap="round" fill="none" />}
            </G>
          )}

          {shape === 'sprout' && (
            <G>
              <Path d={`M100 196 C 99 ${186 - 10 * within}, 101 ${172 - 14 * within}, 100 ${160 - 18 * within}`} stroke="#7FAE63" strokeWidth={3.2} strokeLinecap="round" fill="none" />
              <Ellipse cx={90} cy={160 - 18 * within} rx={10 + 4 * within} ry={5.5 + 2 * within} fill={c.leaf} transform={`rotate(-28 90 ${160 - 18 * within})`} />
              <Ellipse cx={110} cy={156 - 18 * within} rx={11 + 4 * within} ry={6 + 2 * within} fill={c.leafLight} transform={`rotate(24 110 ${156 - 18 * within})`} />
            </G>
          )}

          {trunk && <Trunk height={trunk.h} width={trunk.w} c={c} style={style} />}
          {(shape === 'sapling' || shape === 'young' || shape === 'mature') && (
            <Canopy stage={shape} scale={canopyScale} c={c} style={style} season={season} bloom={bloom} />
          )}

          {season === 'autumn' && shape !== 'seed' && shape !== 'sprout' && !styleInfo(style).premium && (
            <G opacity={0.85}>
              <Ellipse cx={58} cy={192} rx={4} ry={2} fill={c.leafDark} transform="rotate(20 58 192)" />
              <Ellipse cx={146} cy={194} rx={4} ry={2} fill={c.leaf} transform="rotate(-30 146 194)" />
            </G>
          )}
        </Svg>
      </Animated.View>
    </View>
  );
}
