import { router } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, View } from 'react-native';
import { Icon } from '@/components/ui/Icon';
import { Header, Notice, Screen } from '@/components/ui/Layout';
import { Text } from '@/components/ui/Text';
import { fetchNotifications, markNotificationsRead } from '@/lib/api';
import { relativeDay } from '@/lib/format';
import { useFocusData } from '@/lib/useAsync';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';

export default function Notifications() {
  const { colors } = useTheme();
  const list = useFocusData(fetchNotifications);

  useEffect(() => {
    const unread = (list.data ?? []).filter((n) => !n.read_at).map((n) => n.id);
    if (unread.length) markNotificationsRead(unread).catch(() => {});
  }, [list.data]);

  return (
    <Screen>
      <Header onBack={() => router.back()} title="Little notes" subtitle="Gentle updates about your letters." />
      {list.error && <Notice tone="error" message={list.error.message} />}
      {list.data?.length === 0 && <Text color="inkSoft">Nothing new. Your garden is quiet and well.</Text>}
      <View style={{ gap: space.sm }}>
        {list.data?.map((n) => (
          <Pressable
            key={n.id}
            accessibilityRole="button"
            accessibilityLabel={`${n.title}. ${n.body}. ${relativeDay(n.created_at)}`}
            onPress={() => n.letter_id && router.push(`/letter/${n.letter_id}`)}
            style={{ flexDirection: 'row', gap: space.md, padding: space.md, borderRadius: radius.md, backgroundColor: n.read_at ? colors.surface : colors.primarySoft, borderWidth: 1, borderColor: colors.border }}
          >
            <Icon name={n.kind === 'letter_arrived' ? 'sparkle' : n.kind === 'letter_accepted' ? 'garden' : 'mailbox'} color={colors.primary} />
            <View style={{ flex: 1 }}>
              <Text variant="bodyStrong">{n.title}</Text>
              <Text variant="small" color="inkSoft">{n.body}</Text>
              <Text variant="caption" color="muted" style={{ marginTop: 2 }}>{relativeDay(n.created_at)}</Text>
            </View>
          </Pressable>
        ))}
      </View>
    </Screen>
  );
}
