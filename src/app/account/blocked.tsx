import { router } from 'expo-router';
import { View } from 'react-native';
import { Button } from '@/components/ui/Button';
import { Card, Header, Notice, Screen } from '@/components/ui/Layout';
import { Text } from '@/components/ui/Text';
import { myBlocks, unblock } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useFocusData } from '@/lib/useAsync';
import { space } from '@/theme/tokens';

export default function Blocked() {
  const list = useFocusData(myBlocks);
  return (
    <Screen>
      <Header onBack={() => router.back()} title="Blocked senders" subtitle="Blocked people can’t send you new letters, and their letters stay hidden. They aren’t told." />
      {list.error && <Notice tone="error" message={list.error.message} />}
      {list.data?.length === 0 && <Text color="inkSoft">You haven’t blocked anyone.</Text>}
      <View style={{ gap: space.sm }}>
        {list.data?.map((b) => (
          <Card key={b.block_id} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
            <View style={{ flex: 1 }}>
              <Text variant="bodyStrong">{b.label}</Text>
              <Text variant="small" color="muted">Blocked {formatDate(b.created_at)}</Text>
            </View>
            <Button label="Unblock" size="sm" variant="secondary" onPress={async () => { await unblock(b.block_id); list.reload(); }} />
          </Card>
        ))}
      </View>
    </Screen>
  );
}
