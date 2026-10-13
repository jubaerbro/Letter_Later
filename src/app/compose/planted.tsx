import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { Tree } from '@/components/tree/Tree';
import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Layout';
import { Text } from '@/components/ui/Text';
import { useAudio } from '@/lib/audio/AudioProvider';
import { useTheme } from '@/theme/ThemeProvider';
import { space } from '@/theme/tokens';

export default function Planted() {
  const { reduceMotion } = useTheme();
  const { sfx } = useAudio();
  const { id, invited, email, self } = useLocalSearchParams<{ id: string; invited: string; email: string; self: string }>();
  const [stage, setStage] = useState<'seed' | 'sprout'>('seed');

  useEffect(() => {
    sfx('water');
    const t = setTimeout(() => setStage('sprout'), reduceMotion ? 0 : 1200);
    return () => clearTimeout(t);
  }, [sfx, reduceMotion]);

  const message =
    self === '1'
      ? 'Your future self will find it waiting, right on time.'
      : invited === '1'
        ? email === 'provider_accepted'
          ? 'We’ve handed an invitation to our email service. They can claim their mailbox and grow their own tree beside yours.'
          : 'We’re sending them an invitation. If email is slow today, we’ll keep trying quietly in the background.'
        : 'They’ve been told a seed is waiting. When they accept, you’ll get a little note.';

  return (
    <Screen gradient="meadow" scroll={false} footer={
      <View style={{ gap: space.sm }}>
        <Button label="See its tree" size="lg" onPress={() => router.replace(`/letter/${id}`)} />
        <Button label="Back to the garden" variant="ghost" onPress={() => router.dismissTo('/')} />
      </View>
    }>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.lg }}>
        <Animated.View entering={reduceMotion ? FadeIn : FadeInDown.duration(900)}>
          <Tree stage={stage} growth={stage === 'seed' ? 0.08 : 0.22} size={220} pulseKey={stage === 'sprout' ? 1 : 0} />
        </Animated.View>
        <Text variant="hero" center>Your seed is planted</Text>
        <Text color="inkSoft" center style={{ maxWidth: 360 }}>{message}</Text>
      </View>
    </Screen>
  );
}
