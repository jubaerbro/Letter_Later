import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { Tree } from '@/components/tree/Tree';
import { currentSeason } from '@/components/tree/useTree';
import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Layout';
import { Text } from '@/components/ui/Text';
import { space } from '@/theme/tokens';

const PAGES = [
  {
    title: 'Letters that wait for the right moment',
    body: 'Write to someone you love — or to your future self — and choose the day it opens. Next week, or ten years from now.',
    stage: 'seed' as const,
    growth: 0.05,
  },
  {
    title: 'Every letter plants a seed',
    body: 'While it waits, a little tree grows for each of you. Water it, bring it sunlight, or just breathe with it for a moment.',
    stage: 'young' as const,
    growth: 0.7,
  },
  {
    title: 'Sealed until the day comes',
    body: 'Once sent, a letter can’t be changed or opened early — not even by us. On the day, it blooms.',
    stage: 'bloom' as const,
    growth: 1,
  },
];

export default function Welcome() {
  const [page, setPage] = useState(0);
  const p = PAGES[page];
  const last = page === PAGES.length - 1;
  return (
    <Screen
      gradient="dawn"
      footer={
        <View style={{ gap: space.sm }}>
          <Button
            label={last ? 'Begin' : 'Next'}
            size="lg"
            onPress={() => (last ? router.push('/sign-in') : setPage(page + 1))}
          />
          <Button label="I already have an account" variant="ghost" onPress={() => router.push('/sign-in')} />
        </View>
      }
    >
      <View style={{ alignItems: 'center', marginTop: space.xxxl, gap: space.xl }}>
        <Text variant="caption" color="primary" style={{ letterSpacing: 2 }}>
          LETTER LATER
        </Text>
        <Tree stage={p.stage} growth={p.growth} style={page === 2 ? 'cherry' : 'oak'} season={currentSeason()} size={220} />
        <Text variant="hero" center>
          {p.title}
        </Text>
        <Text color="inkSoft" center style={{ maxWidth: 380 }}>
          {p.body}
        </Text>
        <View style={{ flexDirection: 'row', gap: space.sm }} accessibilityLabel={`Page ${page + 1} of ${PAGES.length}`}>
          {PAGES.map((_, i) => (
            <View key={i} style={{ width: i === page ? 22 : 8, height: 8, borderRadius: 4, backgroundColor: i === page ? '#4E7245' : '#C9BFA9' }} />
          ))}
        </View>
      </View>
    </Screen>
  );
}
