import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Button } from '@/components/ui/Button';
import { Header, Notice, Screen, Section } from '@/components/ui/Layout';
import { Text } from '@/components/ui/Text';
import { TextField } from '@/components/ui/TextField';
import { ApiError, blockSender, reportLetter, type ReportReason } from '@/lib/api';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';

const REASONS: { value: ReportReason; label: string }[] = [
  { value: 'harassment', label: 'Harassment or bullying' },
  { value: 'hate', label: 'Hateful content' },
  { value: 'sexual', label: 'Sexual content' },
  { value: 'self_harm', label: 'Self-harm or someone at risk' },
  { value: 'impersonation', label: 'Pretending to be someone else' },
  { value: 'spam', label: 'Spam' },
  { value: 'other', label: 'Something else' },
];

export default function Report() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [alsoBlock, setAlsoBlock] = useState(true);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!reason) return;
    setBusy(true);
    setError(null);
    try {
      await reportLetter(id, reason, details);
      if (alsoBlock) await blockSender(id).catch(() => {});
      setDone(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <Screen footer={<Button label="Done" size="lg" onPress={() => router.dismissTo('/')} />}>
        <Header title="Thank you for telling us" subtitle="Our safety team will review this. You did the right thing." />
        {reason === 'self_harm' && (
          <Notice tone="warning" title="If someone is in danger right now" message="Please contact local emergency services or a crisis line in your country. You don’t have to handle this alone." />
        )}
      </Screen>
    );
  }

  return (
    <Screen footer={<Button label="Send report" size="lg" disabled={!reason} loading={busy} onPress={submit} />}>
      <Header onBack={() => router.back()} title="Report this letter" subtitle="Reports are private. The sender isn’t told who reported them." />
      <View style={{ gap: space.sm }} accessibilityRole="radiogroup">
        {REASONS.map((r) => (
          <Pressable
            key={r.value}
            accessibilityRole="radio"
            accessibilityState={{ checked: reason === r.value }}
            onPress={() => setReason(r.value)}
            style={{ padding: space.md, borderRadius: radius.md, borderWidth: 2, borderColor: reason === r.value ? colors.primary : colors.border, backgroundColor: colors.surface }}
          >
            <Text variant="bodyStrong">{r.label}</Text>
          </Pressable>
        ))}
      </View>
      <Section>
        <TextField label="Anything else? (optional)" value={details} onChangeText={setDetails} multiline maxLength={1000} counter={{ max: 1000 }} />
        <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: alsoBlock }} onPress={() => setAlsoBlock(!alsoBlock)} style={{ paddingVertical: space.md }}>
          <Text>{alsoBlock ? '☑' : '☐'} Also block this sender</Text>
        </Pressable>
        <Text variant="small" color="muted">To review your report, our safety team may read this letter. Nothing else in your account is shared.</Text>
        {error && <Notice tone="error" message={error} />}
      </Section>
    </Screen>
  );
}
