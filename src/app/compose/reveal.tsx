import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { EnvelopePreview } from '@/components/EnvelopePreview';
import { Button } from '@/components/ui/Button';
import { Header, Notice, Screen, Section, ToggleRow } from '@/components/ui/Layout';
import { Text } from '@/components/ui/Text';
import { TextField } from '@/components/ui/TextField';
import { useCompose } from '@/lib/compose';
import { formatDate } from '@/lib/format';
import { useSession } from '@/lib/session';
import { friendlyMessage } from '@shared/domain/messages.ts';
import { envelopeFor, REVEAL_OPTIONS, revealFlags, revealProblems } from '@shared/domain/reveal.ts';
import { LIMITS } from '@shared/domain/validation.ts';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';

export default function ComposeReveal() {
  const { colors } = useTheme();
  const { profile } = useSession();
  const { draft, update, instant } = useCompose();
  const [error, setError] = useState<string | null>(null);
  const choice = { mode: draft.revealMode, showSubject: draft.showSubject, showPreview: draft.showPreview };
  const flags = revealFlags(choice);
  const input = { choice, senderName: profile?.display_name ?? 'You', senderHandle: profile?.handle, subject: draft.subject, preview: draft.preview };

  const next = () => {
    const problems = revealProblems(input);
    if (problems.length) return setError(friendlyMessage(problems[0]));
    setError(null);
    router.push('/compose/review');
  };

  if (draft.isSelf) {
    return (
      <Screen footer={<Button label="Review" size="lg" onPress={() => router.push('/compose/review')} />}>
        <Header onBack={() => router.back()} title="Just for you" subtitle="Letters to your future self stay private. Nobody else will ever see the envelope." />
      </Screen>
    );
  }

  return (
    <Screen footer={<Button label="Review your letter" size="lg" onPress={next} />}>
      <Header onBack={() => router.back()} title="What can they see before it opens?" subtitle="Your letter stays sealed either way. This is only the envelope." />

      <View style={{ gap: space.sm }} accessibilityRole="radiogroup">
        {REVEAL_OPTIONS.map((o) => {
          const selected = draft.revealMode === o.mode;
          return (
            <Pressable
              key={o.mode}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              accessibilityLabel={`${o.title}. ${o.description}`}
              onPress={() => update({ revealMode: o.mode })}
              style={{ padding: space.lg, borderRadius: radius.lg, borderWidth: 2, borderColor: selected ? colors.primary : colors.border, backgroundColor: selected ? colors.primarySoft : colors.surface, flexDirection: 'row', gap: space.md, alignItems: 'center' }}
            >
              <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: selected ? colors.primary : colors.muted, alignItems: 'center', justifyContent: 'center' }}>
                {selected && <View style={{ width: 11, height: 11, borderRadius: 6, backgroundColor: colors.primary }} />}
              </View>
              <View style={{ flex: 1 }}>
                <Text variant="bodyStrong">{o.title}</Text>
                <Text variant="small" color="inkSoft">
                  {o.description}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      {draft.revealMode === 'anonymous' && (
        <Section title="For this mystery letter, also show">
          <ToggleRow label="The subject" detail={draft.subject ? `“${draft.subject}”` : 'You haven’t written a subject'} value={draft.showSubject} onChange={(v) => update({ showSubject: v })} />
          <ToggleRow label="A short note" value={draft.showPreview} onChange={(v) => update({ showPreview: v })} />
          <Text variant="small" color="muted">
            Even anonymous letters can be reported, and we can act on abuse. Please be kind.
          </Text>
        </Section>
      )}

      {flags.showSubject && !draft.subject.trim() && (
        <Section>
          <TextField label="Subject they’ll see" value={draft.subject} onChangeText={(t) => update({ subject: t })} maxLength={LIMITS.subject} />
        </Section>
      )}

      {flags.showPreview && (
        <Section>
          <TextField
            label="A short note for the envelope"
            value={draft.preview}
            onChangeText={(t) => update({ preview: t })}
            maxLength={LIMITS.preview}
            counter={{ max: LIMITS.preview }}
            placeholder="Don’t peek… but I think you’ll smile."
            helper="Visible right away, before the letter opens."
          />
        </Section>
      )}

      {error && (
        <View style={{ marginTop: space.md }}>
          <Notice tone="error" message={error} />
        </View>
      )}

      <Section>
        <EnvelopePreview envelope={envelopeFor(input)} opensLabel={instant ? formatDate(instant.instant, draft.timeZone) : '—'} />
      </Section>
    </Screen>
  );
}
