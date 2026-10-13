import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
import { Modal, Platform, Pressable, View } from 'react-native';
import Animated, { Easing, FadeIn, FadeOut, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { NURTURE_ACTIONS, type NurtureKind } from '@shared/domain/growth.ts';
import { ApiError, careToday, nurture } from '@/lib/api';
import { useAudio } from '@/lib/audio/AudioProvider';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';
import { Button } from '../ui/Button';
import { Icon, type IconName } from '../ui/Icon';
import { Text } from '../ui/Text';

const ICONS: Record<NurtureKind, IconName> = { water: 'water', sunlight: 'sun', moment: 'heart' };

/**
 * Small, optional acts of care. Each can be done once a day; nothing is lost by skipping.
 * Care only changes how lush the tree looks — never when the letter opens.
 */
export function NurturePanel({ treeId, onNurtured, premium }: { treeId: string; onNurtured: (points: number) => void; premium: boolean }) {
  const { colors } = useTheme();
  const { sfx } = useAudio();
  const [done, setDone] = useState<NurtureKind[]>([]);
  const [busy, setBusy] = useState<NurtureKind | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [breathing, setBreathing] = useState(false);

  useEffect(() => {
    careToday(treeId).then(setDone).catch(() => {});
  }, [treeId]);

  const give = async (kind: NurtureKind) => {
    setBusy(kind);
    setMessage(null);
    try {
      const r = await nurture(treeId, kind);
      setDone((d) => Array.from(new Set([...d, kind])));
      if (r.added > 0) {
        sfx(kind);
        if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        onNurtured(r.points);
        setMessage(kind === 'water' ? 'The roots drink happily.' : kind === 'sunlight' ? 'Warm light settles on the leaves.' : 'Your tree feels the calm, too.');
      }
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : 'Something went wrong.');
    } finally {
      setBusy(null);
    }
  };

  const allDone = done.length === 3;

  return (
    <View style={{ gap: space.md }}>
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        {(Object.keys(NURTURE_ACTIONS) as NurtureKind[]).map((kind) => {
          const isDone = done.includes(kind);
          return (
            <Pressable
              key={kind}
              accessibilityRole="button"
              accessibilityState={{ disabled: isDone, busy: busy === kind }}
              accessibilityLabel={`${NURTURE_ACTIONS[kind].label}. ${isDone ? 'Done for today' : NURTURE_ACTIONS[kind].description}`}
              disabled={isDone || busy !== null}
              onPress={() => (kind === 'moment' ? setBreathing(true) : give(kind))}
              style={({ pressed }) => ({
                flex: 1,
                alignItems: 'center',
                gap: space.xs,
                paddingVertical: space.md,
                borderRadius: radius.lg,
                backgroundColor: isDone ? colors.surfaceSunken : pressed ? colors.primarySoft : colors.surface,
                borderWidth: 1,
                borderColor: isDone ? 'transparent' : colors.border,
              })}
            >
              <Icon name={isDone ? 'check' : ICONS[kind]} color={isDone ? colors.muted : colors.primary} size={26} />
              <Text variant="small" color={isDone ? 'muted' : 'ink'} center maxFontSizeMultiplier={1.3}>
                {NURTURE_ACTIONS[kind].label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text variant="small" color="inkSoft" center accessibilityLiveRegion="polite">
        {message ?? (allDone ? 'All cared for today. Come back whenever you like — there’s no streak to keep.' : `Optional, once a day each${premium ? ' · Plus doubles the growth' : ''}.`)}
      </Text>

      {breathing && (
      <BreathingModal
        onClose={() => setBreathing(false)}
        onComplete={() => {
          setBreathing(false);
          give('moment');
        }}
      />
      )}
    </View>
  );
}

/** A 3-breath pause (about 24 seconds). Can be finished early; skipping costs nothing. */
function BreathingModal({ onClose, onComplete }: { onClose: () => void; onComplete: () => void }) {
  const { colors, reduceMotion } = useTheme();
  const scale = useSharedValue(0.6);
  const [phase, setPhase] = useState<'in' | 'out'>('in');
  const [breaths, setBreaths] = useState(0);

  useEffect(() => {
    if (!reduceMotion) scale.value = withRepeat(withTiming(1, { duration: 4000, easing: Easing.inOut(Easing.sin) }), -1, true);
    const interval = setInterval(() => {
      setPhase((p) => {
        if (p === 'out') setBreaths((b) => b + 1);
        return p === 'in' ? 'out' : 'in';
      });
    }, 4000);
    return () => clearInterval(interval);
  }, [reduceMotion, scale]);

  useEffect(() => {
    if (breaths >= 3) onComplete();
  }, [breaths, onComplete]);

  const circle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: colors.overlay, alignItems: 'center', justifyContent: 'center', padding: space.xl }}>
        <View style={{ backgroundColor: colors.surface, borderRadius: radius.xl, padding: space.xl, alignItems: 'center', gap: space.lg, width: '100%', maxWidth: 380 }}>
          <Text variant="heading" center>A quiet moment</Text>
          <Animated.View style={[{ width: 160, height: 160, borderRadius: 80, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }, circle]}>
            <Animated.View key={phase} entering={FadeIn.duration(600)} exiting={FadeOut.duration(400)}>
              <Text variant="bodyStrong" color="primary" accessibilityLiveRegion="polite">
                {phase === 'in' ? 'Breathe in…' : 'and out…'}
              </Text>
            </Animated.View>
          </Animated.View>
          <Text variant="small" color="inkSoft" center>
            Three slow breaths with your tree. {3 - Math.min(3, breaths)} to go.
          </Text>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Button label="Not now" variant="ghost" onPress={onClose} />
            <Button label="I feel calmer" variant="secondary" onPress={onComplete} />
          </View>
        </View>
      </View>
    </Modal>
  );
}
