import { router } from 'expo-router';
import { View } from 'react-native';
import { Tree } from '@/components/tree/Tree';
import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Layout';
import { Text } from '@/components/ui/Text';
import { space } from '@/theme/tokens';

export default function NotFound() {
  return (
    <Screen>
      <View style={{ alignItems: 'center', marginTop: space.xxxl, gap: space.lg }}>
        <Tree stage="sprout" growth={0.2} size={150} />
        <Text variant="title" center>This path leads nowhere</Text>
        <Text color="inkSoft" center>Let’s walk back to the garden.</Text>
        <Button label="Go to the garden" onPress={() => router.replace('/')} />
      </View>
    </Screen>
  );
}
