import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { Button } from '@/components/ui/Button';
import { Card, Header, Notice, Screen, Section } from '@/components/ui/Layout';
import { Text } from '@/components/ui/Text';
import { TextField } from '@/components/ui/TextField';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { space } from '@/theme/tokens';

export default function Security() {
  const { session } = useSession();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  const setNewPassword = async () => {
    if (password.length < 10) return setMessage({ tone: 'error', text: 'Please use at least 10 characters.' });
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    setPassword('');
    setMessage(error ? { tone: 'error', text: 'Couldn’t set the password. You may need to sign in again first.' } : { tone: 'success', text: 'Password saved. You can now sign in with it, or keep using email codes.' });
  };

  const signOutEverywhere = async () => {
    await supabase.auth.signOut({ scope: 'global' });
  };

  return (
    <Screen>
      <Header onBack={() => router.back()} title="Sign-in & security" />
      <Card style={{ gap: space.xs }}>
        <Text variant="caption" color="muted">SIGNED IN AS</Text>
        <Text variant="bodyStrong">{session?.user.email}</Text>
        <Text variant="small" color="inkSoft">You sign in with a one-time code sent to this email. Your email is how letters find you, so keep it safe.</Text>
      </Card>

      <Section title="Optional password">
        <View style={{ gap: space.md }}>
          <TextField label="New password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" textContentType="newPassword" helper="At least 10 characters. Useful if email codes are slow to arrive." />
          <Button label="Save password" variant="secondary" loading={busy} disabled={!password} onPress={setNewPassword} />
          {message && <Notice tone={message.tone} message={message.text} />}
        </View>
      </Section>

      <Section title="Sessions">
        <Button label="Sign out on all devices" variant="secondary" onPress={signOutEverywhere} />
      </Section>
    </Screen>
  );
}
