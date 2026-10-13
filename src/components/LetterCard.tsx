import { router } from 'expo-router';
import { View } from 'react-native';
import type { MailboxItem } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';
import { Countdown } from './Countdown';
import { Envelope } from './Envelope';
import { Tree } from './tree/Tree';
import { currentSeason, treesFor } from './tree/useTree';
import { Card } from './ui/Layout';
import { Text } from './ui/Text';

export function counterpartLabel(item: MailboxItem) {
  if (item.direction === 'self') return 'Future you';
  if (item.direction === 'received') return item.is_anonymous ? 'Someone special' : (item.counterpart_name ?? 'A friend');
  return item.counterpart_name ?? 'Your friend';
}

const STATUS_TEXT: Record<string, string> = {
  waiting: 'Growing',
  arrived: 'Ready to open',
  opened: 'Opened',
  delivered: 'Arrived',
  delayed: 'Delivery delayed — we’re retrying',
  closed: 'Can’t be delivered',
};

export function StatusChip({ item }: { item: MailboxItem }) {
  const { colors } = useTheme();
  const s = item.display_status;
  const bg = s === 'arrived' ? colors.goldSoft : s === 'delayed' || s === 'closed' ? colors.dangerSoft : colors.primarySoft;
  const label = item.direction === 'received' && !item.accepted && s === 'waiting' ? 'New seed' : STATUS_TEXT[s];
  return (
    <View style={{ alignSelf: 'flex-start', backgroundColor: bg, borderRadius: radius.pill, paddingHorizontal: space.sm, paddingVertical: 2 }}>
      <Text variant="caption" color={s === 'delayed' || s === 'closed' ? 'danger' : 'ink'}>
        {label}
      </Text>
    </View>
  );
}

/** Compact tree card for the Garden grid. */
export function TreeTile({ item, hemisphere }: { item: MailboxItem; hemisphere: 'north' | 'south' }) {
  const { mine } = treesFor(item);
  const tree = mine ?? { stage: 'seed' as const, growth: 0.02, style: 'oak' };
  const who = counterpartLabel(item);
  const dir = item.direction === 'sent' ? `To ${who}` : item.direction === 'self' ? 'To future you' : `From ${who}`;
  return (
    <Card
      onPress={() => router.push(`/letter/${item.letter_id}`)}
      accessibilityLabel={`${dir}. ${tree.stage} tree.`}
      style={{ flex: 1, alignItems: 'center', padding: space.md, gap: space.xs }}
    >
      <Tree stage={tree.stage} growth={tree.growth} style={tree.style} season={currentSeason(hemisphere)} size={120} sway={false} />
      <Text variant="bodyStrong" numberOfLines={1} center>
        {dir}
      </Text>
      <Countdown deliverAt={item.deliver_at} compact />
    </Card>
  );
}

/** A glowing "ready to open" card. */
export function ArrivedCard({ item }: { item: MailboxItem }) {
  const who = counterpartLabel(item);
  return (
    <Card tone="gold" onPress={() => router.push(`/letter/${item.letter_id}/open`)} accessibilityLabel={`A letter from ${who} is ready to open`} style={{ alignItems: 'center', gap: space.sm }}>
      <Envelope width={200} initial={item.is_anonymous ? undefined : (who[0] ?? undefined)} />
      <Text variant="heading" center>
        {item.direction === 'self' ? 'A letter from your past self' : `A letter from ${who}`}
      </Text>
      <Text variant="small" color="inkSoft" center>
        It waited since {formatDate(item.created_at)}. Tap to break the seal.
      </Text>
    </Card>
  );
}
