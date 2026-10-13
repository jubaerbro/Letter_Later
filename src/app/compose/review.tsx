import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Card, Header, Notice, Screen, Section } from '@/components/ui/Layout';
import { Text } from '@/components/ui/Text';
import { ApiError, createLetter } from '@/lib/api';
import { useCompose } from '@/lib/compose';
import { formatDateTime } from '@/lib/format';
import { rememberSubject } from '@/lib/localLetters';
import { useSession } from '@/lib/session';
import { describeReveal } from '@shared/domain/reveal.ts';
import { countdown, describeCountdown } from '@shared/domain/time.ts';
import { useTheme } from '@/theme/ThemeProvider';
import { space } from '@/theme/tokens';

export default function ComposeReview() {
  const { colors } = useTheme();
  const { profile } = useSession();
  const { draft, instant, reset } = useCompose();
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reveal = describeReveal({
    choice: { mode: draft.revealMode, showSubject: draft.showSubject, showPreview: draft.showPreview },
    senderName: profile?.display_name ?? 'You',
    subject: draft.subject,
    preview: draft.preview,
  });
  const recipientLabel = draft.isSelf ? 'Future you' : (draft.recipientName ? `${draft.recipientName} (${draft.recipient})` : draft.recipient);

  const send = async () => {
    if (!instant) return;
    setBusy(true);
    setError(null);
    try {
      const result = await createLetter({
        idempotencyKey: draft.idempotencyKey,
        recipient: draft.recipient,
        subject: draft.subject,
        body: draft.body,
        revealMode: draft.isSelf ? 'name_and_date' : draft.revealMode,
        showSubject: draft.showSubject,
        showPreview: draft.showPreview,
        preview: draft.preview,
        deliverAt: instant.instant.toISOString(),
        timeZone: draft.timeZone,
      });
      await rememberSubject(result.letterId, draft.subject);
      reset();
      router.replace({
        pathname: '/compose/planted',
        params: { id: result.letterId, invited: result.invited ? '1' : '0', email: result.invitationEmail ?? '', self: result.isSelf ? '1' : '0' },
      });
    } catch (e) {
      // The idempotency key stays the same, so trying again can never create a second letter.
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Your letter is safe here — please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen footer={<Button label="Seal and plant this letter" icon="lock" size="lg" disabled={!understood || !instant} loading={busy} onPress={send} />}>
      <Header onBack={() => router.back()} title="One last look" />

      <Card style={{ gap: space.md }}>
        <View>
          <Text variant="caption" color="muted">TO</Text>
          <Text variant="bodyStrong">{recipientLabel}</Text>
        </View>
        <View>
          <Text variant="caption" color="muted">OPENS</Text>
          <Text variant="bodyStrong">{instant ? formatDateTime(instant.instant, draft.timeZone) : '—'}</Text>
          {instant && <Text variant="small" color="inkSoft">{describeCountdown(countdown(instant.instant, new Date()))}</Text>}
        </View>
        {draft.subject ? (
          <View>
            <Text variant="caption" color="muted">SUBJECT</Text>
            <Text variant="bodyStrong">{draft.subject}</Text>
          </View>
        ) : null}
        <View>
          <Text variant="caption" color="muted">YOUR LETTER</Text>
          <Text variant="letter" numberOfLines={4}>{draft.body}</Text>
        </View>
      </Card>

      {!draft.isSelf && (
        <Section title="Before it opens they will see">
          <Card tone="sunken" style={{ gap: space.xs }}>
            {reveal.visible.map((v) => (
              <View key={v} style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
                <Icon name="eye" size={18} color={colors.primary} />
                <Text variant="small" style={{ flex: 1 }}>{v}</Text>
              </View>
            ))}
            {reveal.hidden.map((v) => (
              <View key={v} style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
                <Icon name="eyeOff" size={18} color={colors.muted} />
                <Text variant="small" color="inkSoft" style={{ flex: 1 }}>Hidden: {v}</Text>
              </View>
            ))}
          </Card>
        </Section>
      )}

      <Section>
        <Notice
          tone="warning"
          title="Once planted, it can’t be changed"
          message="After you seal this letter you won’t be able to edit it, change the date, or cancel it. It will open exactly when you chose. Nobody — not you, not us — can open it early."
        />
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: understood }}
          onPress={() => setUnderstood(!understood)}
          style={{ flexDirection: 'row', gap: space.md, alignItems: 'center', paddingVertical: space.lg }}
        >
          <View style={{ width: 26, height: 26, borderRadius: 8, borderWidth: 2, borderColor: understood ? colors.primary : colors.border, backgroundColor: understood ? colors.primary : colors.surface, alignItems: 'center', justifyContent: 'center' }}>
            {understood && <Icon name="check" size={18} color={colors.onPrimary} strokeWidth={2.4} />}
          </View>
          <Text style={{ flex: 1 }}>I understand. This letter is ready.</Text>
        </Pressable>
      </Section>

      {error && <Notice tone="error" message={error} />}
    </Screen>
  );
}
