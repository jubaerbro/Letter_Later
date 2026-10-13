import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, View } from 'react-native';
import Animated, { Easing, FadeIn, FadeInUp, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Countdown } from '@/components/Countdown';
import { Envelope } from '@/components/Envelope';
import { counterpartLabel } from '@/components/LetterCard';
import { Button, IconButton } from '@/components/ui/Button';
import { Notice } from '@/components/ui/Layout';
import { Text } from '@/components/ui/Text';
import { ApiError, fetchLetter, letterContent, type MailboxItem } from '@/lib/api';
import { useAudio } from '@/lib/audio/AudioProvider';
import { formatDate } from '@/lib/format';
import { rememberSubject } from '@/lib/localLetters';
import { useTheme } from '@/theme/ThemeProvider';
import { space } from '@/theme/tokens';

type Phase = 'sealed' | 'opening' | 'open';

function Petal({ index, active }: { index: number; active: boolean }) {
  const y = useSharedValue(-40);
  const x = useSharedValue(0);
  const o = useSharedValue(0);
  const startX = useMemo(() => (index * 53) % 300 - 150, [index]);
  useEffect(() => {
    if (!active) return;
    o.value = withDelay(index * 90, withTiming(0.9, { duration: 300 }));
    y.value = withDelay(index * 90, withTiming(520, { duration: 3200 + (index % 4) * 400, easing: Easing.out(Easing.quad) }));
    x.value = withDelay(index * 90, withTiming((index % 2 ? 1 : -1) * (30 + (index % 5) * 12), { duration: 3200 }));
    setTimeout(() => (o.value = withTiming(0, { duration: 800 })), 2600 + index * 90);
  }, [active, index, o, x, y]);
  const style = useAnimatedStyle(() => ({ opacity: o.value, transform: [{ translateY: y.value }, { translateX: startX + x.value }, { rotate: `${y.value / 3}deg` }] }));
  return <Animated.View pointerEvents="none" style={[{ position: 'absolute', top: 0, left: '50%', width: 12, height: 9, borderRadius: 6, backgroundColor: index % 3 ? '#F2B5C4' : '#F7D9A8' }, style]} />;
}

export default function OpenLetter() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors, reduceMotion } = useTheme();
  const insets = useSafeAreaInsets();
  const { sfx } = useAudio();
  const [item, setItem] = useState<MailboxItem | null>(null);
  const [phase, setPhase] = useState<Phase>('sealed');
  const [content, setContent] = useState<{ subject: string; body: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hold = useSharedValue(0);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const breakSeal = async (quiet = false) => {
    if (phase !== 'sealed') return;
    setPhase('opening');
    if (!quiet) {
      sfx('seal');
      if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    }
    try {
      const c = await letterContent(id, true);
      setContent(c);
      rememberSubject(id, c.subject);
      setTimeout(() => {
        setPhase('open');
        if (!quiet) sfx('bloom');
      }, quiet || reduceMotion ? 0 : 900);
    } catch (e) {
      setPhase('sealed');
      setError(e instanceof ApiError ? e.message : 'We couldn’t open it just now. Please try again.');
    }
  };

  useEffect(() => {
    fetchLetter(id)
      .then((l) => {
        setItem(l);
        if (l?.display_status === 'opened') breakSeal(true);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Something went wrong.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const ring = useAnimatedStyle(() => ({ transform: [{ scale: 1 + hold.value * 0.12 }], opacity: 0.25 + hold.value * 0.6 }));

  const who = item ? counterpartLabel(item) : '';
  const notYet = item && item.display_status === 'waiting';

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={{ position: 'absolute', top: insets.top + space.sm, left: space.md, zIndex: 2 }}>
        <IconButton icon="close" label="Close" onPress={() => router.back()} />
      </View>

      {phase !== 'open' ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl, gap: space.xl }}>
          {notYet ? (
            <>
              <Envelope width={240} initial={item?.is_anonymous ? undefined : who[0]} />
              <Text variant="title" center>Not quite yet</Text>
              <Countdown deliverAt={item!.deliver_at} />
              <Text color="inkSoft" center>This letter is sealed until its day. Nobody can open it early.</Text>
            </>
          ) : (
            <>
              <Text variant="caption" color="muted">{item ? `WRITTEN ${formatDate(item.created_at).toUpperCase()}` : ' '}</Text>
              <Text variant="title" center>
                {item?.direction === 'self' ? 'From your past self' : item ? `From ${who}` : ' '}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Break the seal and open the letter"
                accessibilityHint="Press and hold the wax seal, or double tap"
                onPressIn={() => {
                  if (reduceMotion) return;
                  hold.value = withTiming(1, { duration: 1100 });
                  holdTimer.current = setTimeout(() => breakSeal(), 1100);
                }}
                onPressOut={() => {
                  if (holdTimer.current) clearTimeout(holdTimer.current);
                  if (phase === 'sealed') hold.value = withTiming(0, { duration: 250 });
                }}
                onPress={reduceMotion ? () => breakSeal() : undefined}
                style={{ alignItems: 'center', justifyContent: 'center' }}
              >
                <Animated.View style={[{ position: 'absolute', width: 120, height: 120, borderRadius: 60, backgroundColor: colors.goldSoft, top: 70 }, ring]} />
                <Envelope width={260} open={phase === 'opening'} initial={item?.is_anonymous ? undefined : who[0]} />
              </Pressable>
              <Text color="inkSoft" center>{phase === 'opening' ? 'Unfolding…' : 'Press and hold the seal'}</Text>
              <Button label="Open it" variant="ghost" onPress={() => breakSeal()} accessibilityHint="Opens without holding" />
              {error && <Notice tone="error" message={error} />}
            </>
          )}
          {phase === 'opening' && !reduceMotion && Array.from({ length: 16 }).map((_, i) => <Petal key={i} index={i} active />)}
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingTop: insets.top + 64, paddingHorizontal: space.lg, paddingBottom: insets.bottom + space.xxl, maxWidth: 680, width: '100%', alignSelf: 'center' }}>
          <Animated.View entering={reduceMotion ? FadeIn : FadeInUp.duration(900).easing(Easing.out(Easing.cubic))} style={{ backgroundColor: colors.paper, borderRadius: 20, padding: space.xl, gap: space.lg, shadowColor: colors.shadow, shadowOpacity: 1, shadowRadius: 24, elevation: 3 }}>
            <Text variant="caption" style={{ color: '#6B6558' }}>
              {item ? `Written ${formatDate(item.created_at)} · opened ${formatDate(new Date())}` : ''}
            </Text>
            {content?.subject ? <Text variant="title" style={{ color: '#2C3829' }}>{content.subject}</Text> : null}
            <Text variant="letter" style={{ color: '#2C3829' }} selectable>{content?.body}</Text>
            <Text variant="letter" style={{ color: '#56634F', fontFamily: 'Fraunces_400Regular_Italic' }}>
              — {item?.direction === 'self' ? 'you, from the past' : item?.is_anonymous ? 'someone who cares about you' : who}
            </Text>
          </Animated.View>
          <Animated.View entering={FadeIn.delay(reduceMotion ? 0 : 900)} style={{ gap: space.sm, marginTop: space.xl }}>
            <Button label="Back to the garden" onPress={() => router.dismissTo('/')} />
            {item?.direction === 'received' && (
              <Button label="Report this letter" variant="ghost" onPress={() => router.push({ pathname: '/report', params: { id } })} />
            )}
          </Animated.View>
        </ScrollView>
      )}
    </View>
  );
}
