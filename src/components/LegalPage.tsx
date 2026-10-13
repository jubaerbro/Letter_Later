import { router } from 'expo-router';
import { View } from 'react-native';
import { Header, Screen } from './ui/Layout';
import { Text } from './ui/Text';
import { space } from '@/theme/tokens';

export function LegalPage({ title, updated, sections }: { title: string; updated: string; sections: { heading: string; body: string[] }[] }) {
  return (
    <Screen>
      <Header onBack={router.canGoBack() ? () => router.back() : () => router.replace('/')} title={title} subtitle={`Last updated ${updated}`} />
      <View style={{ gap: space.xl }}>
        {sections.map((s) => (
          <View key={s.heading} style={{ gap: space.sm }}>
            <Text variant="heading">{s.heading}</Text>
            {s.body.map((p, i) => (
              <Text key={i} color="inkSoft">
                {p}
              </Text>
            ))}
          </View>
        ))}
      </View>
    </Screen>
  );
}
