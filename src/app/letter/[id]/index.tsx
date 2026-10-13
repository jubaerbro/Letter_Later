import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Modal, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Countdown } from '@/components/Countdown';
import { counterpartLabel, StatusChip } from '@/components/LetterCard';
import { NurturePanel } from '@/components/tree/NurturePanel';
import { StylePicker } from '@/components/tree/StylePicker';
import { Tree } from '@/components/tree/Tree';
import { currentSeason, treesFor } from '@/components/tree/useTree';
import { Button, IconButton } from '@/components/ui/Button';
import { Card, Divider, Header, Notice, Row, Screen, Section } from '@/components/ui/Layout';
import { Text } from '@/components/ui/Text';
import { acceptLetter, ApiError, blockSender, declineLetter, fetchLetter, letterContent, type MailboxItem } from '@/lib/api';
import { formatDate, formatDateTime } from '@/lib/format';
import { getPref } from '@/lib/prefs';
import { useSession } from '@/lib/session';
import { useFocusData } from '@/lib/useAsync';
import { STAGE_LABELS } from '@shared/domain/growth.ts';
import { useTheme } from '@/theme/ThemeProvider';
import { space } from '@/theme/tokens';

const INVITE_TEXT: Record<string, string> = {
  queued: 'Invitation email waiting to send — we retry automatically.',
  sending: 'Invitation email sending…',
  provider_accepted: 'Invitation handed to our email service. (That doesn’t guarantee it reached their inbox or was read.)',
  failed: 'We couldn’t send the invitation email. The letter will still be waiting for them if they sign up with that address.',
  skipped: 'No invitation email was sent (the address opted out, or received several today). The letter still waits for them.',
};

export default function LetterDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { profile, premium } = useSession();
  const letter = useFocusData(() => fetchLetter(id), [id]);
  const [pulse, setPulse] = useState(0);
  const [treesOn, setTreesOn] = useState(true);
  const [busy, setBusy] = useState(false);
  const [sentCopy, setSentCopy] = useState<{ subject: string; body: string } | null>(null);
  const hemisphere = profile?.hemisphere ?? 'north';

  useEffect(() => {
    getPref('treeExperience').then(setTreesOn);
  }, []);

  const item = letter.data;
  if (!item) {
    return (
      <Screen>
        <Header onBack={() => router.back()} />
        {letter.error ? <Notice tone="error" message={letter.error.message} /> : !letter.loading && <Notice message="We couldn’t find that letter. It may have been removed." />}
      </Screen>
    );
  }

  const who = counterpartLabel(item);
  const received = item.direction !== 'sent';
  const { mine, theirs } = treesFor(item);
  const waiting = item.display_status === 'waiting';
  const updateLocal = (patch: Partial<MailboxItem>) => letter.setData({ ...item, ...patch });

  const accept = async () => {
    setBusy(true);
    try {
      await acceptLetter(item.letter_id);
      await letter.reload();
    } finally {
      setBusy(false);
    }
  };

  const confirmBlock = () =>
    Alert.alert(
      'Block this sender?',
      'Their letters to you will be hidden and future letters stopped. They won’t be told. You can unblock later in settings.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Block',
          style: 'destructive',
          onPress: async () => {
            await blockSender(item.letter_id).catch(() => {});
            router.dismissTo('/');
          },
        },
      ],
    );

  const notForMe = () =>
    Alert.alert('Hide this letter?', 'It will be removed from your mailbox. The sender won’t be told.', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Hide',
        onPress: async () => {
          await declineLetter(item.letter_id).catch(() => {});
          router.back();
        },
      },
    ]);

  const readMine = async () => {
    try {
      setSentCopy(await letterContent(item.letter_id, false));
    } catch (e) {
      Alert.alert('Couldn’t open your copy', e instanceof ApiError ? e.message : 'Please try again.');
    }
  };

  const title = item.direction === 'sent' ? `To ${who}` : item.direction === 'self' ? 'To future you' : `From ${who}`;

  return (
    <Screen>
      <Header onBack={() => router.back()} right={received && item.direction !== 'self' ? <IconButton icon="flag" label="Report this letter" onPress={() => router.push({ pathname: '/report', params: { id: item.letter_id } })} /> : undefined} />
      <Text variant="title">{title}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.xs }}>
        <StatusChip item={item} />
        {item.subject && <Text variant="small" color="inkSoft" numberOfLines={1} style={{ flex: 1 }}>“{item.subject}”</Text>}
      </View>
      {item.preview && (
        <Text variant="body" color="inkSoft" style={{ fontStyle: 'italic', marginTop: space.sm }}>
          {item.preview}
        </Text>
      )}

      {item.direction === 'received' && !item.accepted && waiting && (
        <Card tone="primary" style={{ marginTop: space.lg, gap: space.sm }}>
          <Text variant="heading">A seed is waiting for you</Text>
          <Text variant="small" color="inkSoft">Accept it to plant your own tree. {item.is_anonymous ? 'The sender chose to stay a mystery.' : `${who} will see your tree grow, and you’ll see theirs.`}</Text>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Button label="Accept" loading={busy} onPress={accept} />
            <Button label="Not for me" variant="ghost" onPress={notForMe} />
          </View>
        </Card>
      )}

      {treesOn && (mine || theirs) && (
        <Section>
          <View style={{ flexDirection: 'row', gap: space.md }}>
            {mine && (
              <Card style={{ flex: 1, alignItems: 'center', padding: space.sm }}>
                <Tree stage={mine.stage} growth={mine.growth} style={mine.style} season={currentSeason(hemisphere)} size={theirs ? 140 : 220} pulseKey={pulse} label={`Your tree: ${STAGE_LABELS[mine.stage]}`} />
                <Text variant="bodyStrong">Your tree</Text>
                <Text variant="caption" color="muted">{STAGE_LABELS[mine.stage]}</Text>
              </Card>
            )}
            {(theirs || (item.direction === 'sent' && !item.accepted)) && (
              <Card style={{ flex: 1, alignItems: 'center', padding: space.sm }} tone={theirs ? 'surface' : 'sunken'}>
                {theirs ? (
                  <Tree stage={theirs.stage} growth={theirs.growth} style={theirs.style} season={currentSeason(hemisphere)} size={140} label={`${received ? 'Their' : `${who}’s`} tree: ${STAGE_LABELS[theirs.stage]}`} />
                ) : (
                  <View style={{ height: 154, justifyContent: 'center' }}>
                    <Text variant="small" color="inkSoft" center>Their tree will sprout when they accept.</Text>
                  </View>
                )}
                <Text variant="bodyStrong" numberOfLines={1}>{received ? (item.is_anonymous ? 'Their tree' : `${who}’s tree`) : `${who}’s tree`}</Text>
                {theirs && <Text variant="caption" color="muted">{STAGE_LABELS[theirs.stage]}</Text>}
              </Card>
            )}
          </View>
        </Section>
      )}

      <Section title={waiting ? 'Opens in' : 'Opened on'}>
        {waiting ? <Countdown deliverAt={item.deliver_at} /> : null}
        <Text variant="small" color="inkSoft" center style={{ marginTop: space.sm }}>
          {formatDateTime(item.deliver_at)}
        </Text>
        <Text variant="caption" color="muted" center style={{ marginTop: space.xs }}>
          Tree growth is just for joy — the opening date never changes.
        </Text>
      </Section>

      {item.display_status === 'arrived' && received && (
        <Section>
          <Button label="Open your letter" icon="sparkle" size="lg" onPress={() => router.push(`/letter/${item.letter_id}/open`)} />
        </Section>
      )}
      {item.display_status === 'opened' && received && (
        <Section>
          <Button label="Read it again" variant="secondary" onPress={() => router.push(`/letter/${item.letter_id}/open`)} />
        </Section>
      )}

      {treesOn && waiting && mine && item.my_tree_id && (item.accepted || item.direction !== 'received') && (
        <Section title="Care for your tree">
          <NurturePanel
            treeId={item.my_tree_id}
            premium={premium}
            onNurtured={(points) => {
              updateLocal({ my_tree_points: points });
              setPulse((p) => p + 1);
            }}
          />
        </Section>
      )}

      {treesOn && item.my_tree_id && (
        <Section title="Tree style">
          <StylePicker treeId={item.my_tree_id} current={item.my_tree_style ?? 'oak'} onChange={(s) => updateLocal({ my_tree_style: s })} />
        </Section>
      )}

      {item.direction !== 'received' && (
        <Section title="Your letter">
          <Card style={{ gap: space.xs }}>
            <Row icon="clock" label="Planted" detail={formatDate(item.created_at)} />
            <Divider />
            {item.direction === 'sent' && item.invite_status && (
              <>
                <Row icon="mailbox" label="Invitation" detail={INVITE_TEXT[item.invite_status]} />
                <Divider />
              </>
            )}
            {item.direction === 'sent' && (
              <>
                <Row icon="check" label={item.accepted ? 'Accepted' : 'Not accepted yet'} detail={item.accepted ? 'Their tree is growing too.' : 'It still arrives on the day, even if they never accept.'} />
                <Divider />
              </>
            )}
            <Row
              icon="calendar"
              label={item.display_status === 'opened' ? 'Opened' : item.display_status === 'delivered' ? 'Arrived in their mailbox' : item.display_status === 'delayed' ? 'Delivery delayed' : item.display_status === 'closed' ? 'Can’t be delivered' : 'Arrives'}
              detail={item.display_status === 'opened' && item.opened_at ? formatDateTime(item.opened_at) : item.display_status === 'delayed' ? 'Something slowed us down. We’re retrying automatically.' : formatDateTime(item.deliver_at)}
            />
          </Card>
          <Button label="Read what you wrote" variant="secondary" icon="eye" style={{ marginTop: space.md }} onPress={readMine} />
          <Text variant="small" color="muted" center style={{ marginTop: space.sm }}>Sent letters can’t be edited, rescheduled or cancelled.</Text>
        </Section>
      )}

      {received && item.direction !== 'self' && (
        <Section title="Safety">
          <Row icon="flag" label="Report this letter" detail="Our team will review it." onPress={() => router.push({ pathname: '/report', params: { id: item.letter_id } })} />
          <Row icon="shield" label="Block this sender" detail="They won’t be told." onPress={confirmBlock} destructive />
        </Section>
      )}

      <SentCopyModal copy={sentCopy} onClose={() => setSentCopy(null)} />
    </Screen>
  );
}

function SentCopyModal({ copy, onClose }: { copy: { subject: string; body: string } | null; onClose: () => void }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={!!copy} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top }}>
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', padding: space.sm }}>
          <IconButton icon="close" label="Close" onPress={onClose} />
        </View>
        <ScrollView contentContainerStyle={{ padding: space.xl, paddingBottom: insets.bottom + space.xxl }}>
          <View style={{ backgroundColor: colors.paper, borderRadius: 18, padding: space.xl, gap: space.md }}>
            <Text variant="caption" style={{ color: '#6B6558' }}>YOUR SEALED LETTER (READ-ONLY)</Text>
            {copy?.subject ? <Text variant="heading" style={{ color: '#2C3829' }}>{copy.subject}</Text> : null}
            <Text variant="letter" style={{ color: '#2C3829' }} selectable>{copy?.body}</Text>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}
