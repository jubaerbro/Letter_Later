import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { counterpartLabel, StatusChip } from '@/components/LetterCard';
import { Tree } from '@/components/tree/Tree';
import { currentSeason, treesFor } from '@/components/tree/useTree';
import { Icon } from '@/components/ui/Icon';
import { Notice, Segmented } from '@/components/ui/Layout';
import { Text } from '@/components/ui/Text';
import { TextField } from '@/components/ui/TextField';
import { fetchMailbox, type MailboxItem } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { rememberedSubjects } from '@/lib/localLetters';
import { useSession } from '@/lib/session';
import { useFocusData } from '@/lib/useAsync';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';

type Segment = 'waiting' | 'arrived' | 'opened' | 'sent';

function segmentOf(i: MailboxItem): Segment {
  if (i.direction === 'sent') return 'sent';
  if (i.display_status === 'arrived') return 'arrived';
  if (i.display_status === 'opened') return 'opened';
  return 'waiting';
}

export default function Mailbox() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { profile } = useSession();
  const mailbox = useFocusData(fetchMailbox);
  const [segment, setSegment] = useState<Segment>('waiting');
  const [query, setQuery] = useState('');
  const [subjects, setSubjects] = useState<Record<string, string>>({});

  useEffect(() => {
    rememberedSubjects().then(setSubjects);
  }, [mailbox.data]);

  const items = useMemo(() => mailbox.data ?? [], [mailbox.data]);
  const counts = useMemo(() => {
    const c: Record<Segment, number> = { waiting: 0, arrived: 0, opened: 0, sent: 0 };
    items.forEach((i) => c[segmentOf(i)]++);
    return c;
  }, [items]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items
      .filter((i) => (q ? true : segmentOf(i) === segment))
      .filter((i) => {
        if (!q) return true;
        const hay = [counterpartLabel(i), i.counterpart_handle, i.subject, i.preview, subjects[i.letter_id], formatDate(i.deliver_at)]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return hay.includes(q);
      })
      .sort((a, b) => (segment === 'waiting' || segment === 'sent' ? a.deliver_at.localeCompare(b.deliver_at) : b.deliver_at.localeCompare(a.deliver_at)));
  }, [items, segment, query, subjects]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <FlatList
        data={visible}
        keyExtractor={(i) => i.letter_id}
        contentContainerStyle={{ paddingTop: insets.top + space.md, paddingHorizontal: space.xl, paddingBottom: space.xxxl, gap: space.sm, maxWidth: 680, width: '100%', alignSelf: 'center' }}
        refreshControl={<RefreshControl refreshing={mailbox.loading && !!mailbox.data} onRefresh={mailbox.reload} tintColor={colors.primary} />}
        ListHeaderComponent={
          <View style={{ gap: space.md, marginBottom: space.sm }}>
            <Text variant="title">Mailbox</Text>
            <TextField label="Search letters" value={query} onChangeText={setQuery} placeholder="Name, subject or date" autoCapitalize="none" returnKeyType="search" />
            {!query && (
              <Segmented<Segment>
                value={segment}
                onChange={setSegment}
                options={[
                  { value: 'waiting', label: 'Waiting', count: counts.waiting },
                  { value: 'arrived', label: 'Arrived', count: counts.arrived },
                  { value: 'opened', label: 'Opened', count: counts.opened },
                  { value: 'sent', label: 'Sent', count: counts.sent },
                ]}
              />
            )}
            {mailbox.error && <Notice tone="error" message={mailbox.error.message} action={{ label: 'Try again', onPress: mailbox.reload }} />}
            {segment === 'sent' && !query && (
              <Text variant="small" color="muted">
                “Delivered” means the letter is waiting in their mailbox. Email notices are handed to our email provider, which can’t confirm they were read.
              </Text>
            )}
          </View>
        }
        ListEmptyComponent={
          mailbox.data ? (
            <View style={{ alignItems: 'center', paddingVertical: space.xxl, gap: space.sm }}>
              <Icon name="mailbox" size={36} color={colors.muted} />
              <Text color="inkSoft" center>
                {query ? 'No letters match that search.' : { waiting: 'No letters growing yet.', arrived: 'Nothing waiting to be opened.', opened: 'Opened letters will rest here.', sent: 'Letters you plant will appear here.' }[segment]}
              </Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => <MailRow item={item} hemisphere={profile?.hemisphere ?? 'north'} subject={item.subject ?? subjects[item.letter_id]} />}
      />
    </View>
  );
}

function MailRow({ item, hemisphere, subject }: { item: MailboxItem; hemisphere: 'north' | 'south'; subject?: string }) {
  const { colors } = useTheme();
  const { mine } = treesFor(item);
  const who = counterpartLabel(item);
  const title = item.direction === 'sent' ? `To ${who}` : item.direction === 'self' ? 'To future you' : `From ${who}`;
  const go = () => router.push(item.display_status === 'arrived' && item.direction !== 'sent' ? `/letter/${item.letter_id}/open` : `/letter/${item.letter_id}`);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${subject ?? ''}. Opens ${formatDate(item.deliver_at)}.`}
      onPress={go}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.lg, backgroundColor: pressed ? colors.surfaceSunken : colors.surface, borderWidth: 1, borderColor: colors.border })}
    >
      <Tree stage={mine?.stage ?? 'seed'} growth={mine?.growth ?? 0.05} style={mine?.style ?? 'oak'} season={currentSeason(hemisphere)} size={56} sway={false} fit />
      <View style={{ flex: 1, gap: 2 }}>
        <StatusChip item={item} />
        <Text variant="bodyStrong" numberOfLines={1}>
          {title}
        </Text>
        {subject ? (
          <Text variant="small" color="inkSoft" numberOfLines={1}>
            {subject}
          </Text>
        ) : null}
        <Text variant="small" color="muted">
          {item.display_status === 'opened' || item.display_status === 'arrived' || item.display_status === 'delivered' ? 'Arrived ' : 'Opens '}
          {formatDate(item.deliver_at)}
        </Text>
      </View>
    </Pressable>
  );
}
