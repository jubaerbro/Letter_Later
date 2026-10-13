import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { TimeZonePicker } from '@/components/TimeZonePicker';
import { Button } from '@/components/ui/Button';
import { Header, Notice, Screen, Section } from '@/components/ui/Layout';
import { TextField } from '@/components/ui/TextField';
import { ApiError, changeHandle, updateProfile } from '@/lib/api';
import { useSession } from '@/lib/session';
import { isValidHandle, normalizeHandle } from '@shared/domain/validation.ts';
import { space } from '@/theme/tokens';

export default function ProfileSettings() {
  const { profile, refresh } = useSession();
  const [name, setName] = useState(profile?.display_name ?? '');
  const [handle, setHandle] = useState(profile?.handle ?? '');
  const [tz, setTz] = useState(profile?.time_zone ?? 'UTC');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  if (!profile) return null;

  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      if (name.trim() !== profile.display_name || tz !== profile.time_zone) {
        await updateProfile(profile.id, { display_name: name.trim(), time_zone: tz });
      }
      const h = normalizeHandle(handle);
      if (h !== profile.handle) {
        if (!isValidHandle(h)) throw new ApiError('handle_invalid');
        await changeHandle(h);
      }
      await refresh();
      setMessage({ tone: 'success', text: 'Saved.' });
    } catch (e) {
      setMessage({ tone: 'error', text: e instanceof ApiError ? e.message : 'Couldn’t save. Please try again.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen footer={<Button label="Save" size="lg" loading={busy} onPress={save} />}>
      <Header onBack={() => router.back()} title="Name & address" />
      <View style={{ gap: space.lg }}>
        <TextField label="Display name" value={name} onChangeText={setName} maxLength={40} helper="Shown to people you write to, unless you send anonymously. Letters already sent keep the name they were sent with." />
        <TextField
          label="Personal address"
          value={handle}
          onChangeText={(t) => setHandle(t.toLowerCase())}
          autoCapitalize="none"
          autoCorrect={false}
          helper="3–24 letters, numbers or dashes. You can change it once every 30 days."
        />
        <Section title="Time zone">
          <TimeZonePicker value={tz} onChange={setTz} />
        </Section>
        {message && <Notice tone={message.tone} message={message.text} />}
      </View>
    </Screen>
  );
}
