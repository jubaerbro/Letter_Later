import AsyncStorage from '@react-native-async-storage/async-storage';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrivedCard, counterpartLabel, TreeTile } from '@/components/LetterCard';
import { Tree } from '@/components/tree/Tree';
import { currentSeason } from '@/components/tree/useTree';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Card, Notice, Section } from '@/components/ui/Layout';
import { Text } from '@/components/ui/Text';
import { acceptLetter, fetchMailbox, fetchNotifications, type MailboxItem } from '@/lib/api';
import { PENDING_CLAIM_KEY } from '@/lib/localLetters';
import { enablePush, pushPermissionStatus } from '@/lib/notifications';
import { getPref, setPref } from '@/lib/prefs';
import { useSession } from '@/lib/session';
import { useFocusData } from '@/lib/useAsync';
import { useTheme } from '@/theme/ThemeProvider';
import { space } from '@/theme/tokens';

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'Quiet night';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

export default function Garden() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { profile } = useSession();
  const hemisphere = profile?.hemisphere ?? 'north';
  const mailbox = useFocusData(fetchMailbox);
  const [unread, setUnread] = useState(0);
  const [askPush, setAskPush] = useState(false);
  const [accepting, setAccepting] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      fetchNotifications().then((n) => setUnread(n.filter((x) => !x.read_at).length)).catch(() => {});
      (async () => {
        // A claim link opened before sign-up finishes here, once the garden exists.
        const pending = await AsyncStorage.getItem(PENDING_CLAIM_KEY);
        if (pending) {
          await AsyncStorage.removeItem(PENDING_CLAIM_KEY);
          router.push({ pathname: '/claim', params: { token: pending } });
        }
        const asked = await getPref('pushAsked');
        setAskPush(!asked && (await pushPermissionStatus()) === 'undetermined');
      })();
    }, []),
  );

  const items = useMemo(() => mailbox.data ?? [], [mailbox.data]);
  const arrived = items.filter((i) => i.display_status === 'arrived' && i.direction !== 'sent');
  const newSeeds = items.filter((i) => i.direction === 'received' && !i.accepted && i.display_status === 'waiting');
  const growing = items.filter((i) => i.display_status === 'waiting' && (i.direction !== 'received' || i.accepted));

  const accept = async (item: MailboxItem) => {
    setAccepting(item.letter_id);
    try {
      await acceptLetter(item.letter_id);
      await mailbox.reload();
    } finally {
      setAccepting(null);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + space.md, paddingHorizontal: space.xl, paddingBottom: space.xxxl, maxWidth: 680, width: '100%', alignSelf: 'center' }}
        refreshControl={<RefreshControl refreshing={mailbox.loading && !!mailbox.data} onRefresh={mailbox.reload} tintColor={colors.primary} />}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flex: 1 }}>
            <Text variant="small" color="inkSoft">
              {greeting()},
            </Text>
            <Text variant="title" numberOfLines={1}>
              {profile?.display_name ?? 'friend'}
            </Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={unread ? `Notifications, ${unread} new` : 'Notifications'} onPress={() => router.push('/notifications')} style={{ padding: space.sm }}>
            <Icon name="bell" />
            {unread > 0 && <View style={{ position: 'absolute', top: 8, right: 8, width: 9, height: 9, borderRadius: 5, backgroundColor: colors.accent }} />}
          </Pressable>
        </View>

        <Button label="Write a letter" icon="pen" size="lg" style={{ marginTop: space.lg }} onPress={() => router.push('/compose')} />

        {mailbox.error && !mailbox.data && <View style={{ marginTop: space.lg }}><Notice tone="error" message={mailbox.error.message} action={{ label: 'Try again', onPress: mailbox.reload }} /></View>}

        {askPush && items.length > 0 && (
          <Section>
            <Notice
              title="A gentle note when it’s time?"
              message="We can let you know when a letter arrives or a friend accepts yours. Nothing else, ever."
              action={{
                label: 'Yes, remind me',
                onPress: async () => {
                  await setPref('pushAsked', true);
                  setAskPush(false);
                  await enablePush().catch(() => false);
                },
              }}
            />
          </Section>
        )}

        {arrived.length > 0 && (
          <Section title="Ready to open">
            <View style={{ gap: space.md }}>
              {arrived.map((item) => (
                <ArrivedCard key={item.letter_id} item={item} />
              ))}
            </View>
          </Section>
        )}

        {newSeeds.length > 0 && (
          <Section title="New seeds for you">
            <View style={{ gap: space.md }}>
              {newSeeds.map((item) => (
                <Card key={item.letter_id} tone="primary" style={{ gap: space.sm }}>
                  <Text variant="heading">{item.is_anonymous ? 'Someone planted a letter for you' : `${counterpartLabel(item)} planted a letter for you`}</Text>
                  <Text variant="small" color="inkSoft">
                    Accept it to grow your own tree beside theirs while you wait.
                  </Text>
                  <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.xs }}>
                    <Button label="Accept" size="sm" loading={accepting === item.letter_id} onPress={() => accept(item)} />
                    <Button label="Details" size="sm" variant="secondary" onPress={() => router.push(`/letter/${item.letter_id}`)} />
                  </View>
                </Card>
              ))}
            </View>
          </Section>
        )}

        {growing.length > 0 && (
          <Section title="Growing">
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
              {growing.map((item) => (
                <View key={item.letter_id} style={{ width: '47%', flexGrow: 1 }}>
                  <TreeTile item={item} hemisphere={hemisphere} />
                </View>
              ))}
            </View>
          </Section>
        )}

        {mailbox.data && items.length === 0 && (
          <View style={{ alignItems: 'center', marginTop: space.xxl, gap: space.md }}>
            <Tree stage="seed" growth={0.06} season={currentSeason(hemisphere)} size={170} />
            <Text variant="heading" center>
              Your garden is waiting for its first seed
            </Text>
            <Text color="inkSoft" center style={{ maxWidth: 340 }}>
              Write to someone you love, or to yourself a year from now. Every letter grows a tree.
            </Text>
            <Button label="Write to future me" variant="secondary" onPress={() => router.push({ pathname: '/compose', params: { toSelf: '1' } })} />
          </View>
        )}
      </ScrollView>
    </View>
  );
}
