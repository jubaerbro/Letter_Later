import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Tree } from '@/components/tree/Tree';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Card, Header, Notice, Screen } from '@/components/ui/Layout';
import { Text } from '@/components/ui/Text';
import { TextField } from '@/components/ui/TextField';
import { TimeZonePicker } from '@/components/TimeZonePicker';
import { ApiError, completeOnboarding } from '@/lib/api';
import { deviceHemisphere, deviceTimeZone } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';

function Check({ checked, onToggle, children, label }: { checked: boolean; onToggle: () => void; children: React.ReactNode; label: string }) {
  const { colors } = useTheme();
  return (
    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked }} accessibilityLabel={label} onPress={onToggle} style={{ flexDirection: 'row', gap: space.md, alignItems: 'flex-start', paddingVertical: space.sm }}>
      <View style={{ width: 26, height: 26, borderRadius: 8, borderWidth: 2, borderColor: checked ? colors.primary : colors.border, backgroundColor: checked ? colors.primary : colors.surface, alignItems: 'center', justifyContent: 'center' }}>
        {checked && <Icon name="check" size={18} color={colors.onPrimary} strokeWidth={2.4} />}
      </View>
      <View style={{ flex: 1 }}>{children}</View>
    </Pressable>
  );
}

export default function Onboarding() {
  const { profile, refresh, signOut } = useSession();
  const [name, setName] = useState('');
  const [timeZone, setTimeZone] = useState(deviceTimeZone());
  const [terms, setTerms] = useState(false);
  const [age, setAge] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      await completeOnboarding({ displayName: name.trim(), timeZone, hemisphere: deviceHemisphere(), acceptTerms: terms, confirmAge: age });
      await refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen gradient="meadow" footer={<Button label="Plant my garden" size="lg" loading={busy} disabled={!name.trim() || !terms || !age} onPress={submit} />}>
      <Header title="Your little corner" subtitle="A few gentle details, and your garden is ready." />
      <View style={{ alignItems: 'center', marginBottom: space.lg }}>
        <Tree stage="sprout" growth={0.2} size={140} />
      </View>

      <View style={{ gap: space.lg }}>
        <TextField label="What should people call you?" value={name} onChangeText={setName} maxLength={40} autoComplete="name" helper="Shown to people you write to (unless you send anonymously)." />

        <Card tone="sunken">
          <Text variant="caption" color="inkSoft">
            YOUR PERSONAL ADDRESS
          </Text>
          <Text variant="heading" style={{ marginTop: space.xs }} selectable>
            @{profile?.handle ?? '…'}
          </Text>
          <Text variant="small" color="inkSoft" style={{ marginTop: space.xs }}>
            Friends can send letters to this address. It isn’t listed anywhere — only people you share it with can use it. You can change it later.
          </Text>
        </Card>

        <TimeZonePicker value={timeZone} onChange={setTimeZone} />

        <View style={{ borderRadius: radius.md }}>
          <Check checked={terms} onToggle={() => setTerms(!terms)} label="I agree to the Terms and Privacy Policy">
            <Text variant="small">
              I agree to the{' '}
              <Text variant="small" color="primary" onPress={() => router.push('/legal/terms')}>
                Terms
              </Text>{' '}
              (including being kind — no harassment or harmful content) and the{' '}
              <Text variant="small" color="primary" onPress={() => router.push('/legal/privacy')}>
                Privacy Policy
              </Text>
              .
            </Text>
          </Check>
          <Check checked={age} onToggle={() => setAge(!age)} label="I am at least 13 years old">
            <Text variant="small">I am at least 13 years old.</Text>
          </Check>
        </View>

        {error && <Notice tone="error" message={error} />}
        <Button label="Sign out" variant="ghost" size="sm" onPress={signOut} />
      </View>
    </Screen>
  );
}
