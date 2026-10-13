import { router } from 'expo-router';
import { useState } from 'react';
import { Platform, View } from 'react-native';
import { Button } from '@/components/ui/Button';
import { Card, Header, Notice, Screen, Section } from '@/components/ui/Layout';
import { Text } from '@/components/ui/Text';
import { TextField } from '@/components/ui/TextField';
import { ApiError, deleteAccount } from '@/lib/api';
import { clearLocalLetterData } from '@/lib/localLetters';
import { unregisterPush } from '@/lib/notifications';
import { openManageSubscriptions, resetPurchasesUser } from '@/lib/purchases';
import { useSession } from '@/lib/session';
import { space } from '@/theme/tokens';

export default function DeleteAccount() {
  const { signOut, premium } = useSession();
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await unregisterPush();
      await deleteAccount();
      await resetPurchasesUser();
      await clearLocalLetterData();
      await signOut();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Nothing was deleted — please try again.');
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Header onBack={() => router.back()} title="Delete your account" subtitle="We’re sorry to see you go. Here is exactly what happens:" />
      <Card style={{ gap: space.sm }}>
        <Text>• Your profile, personal address, trees, notifications and settings are deleted.</Text>
        <Text>• Letters you sent that haven’t arrived yet are cancelled and erased. They will never be delivered.</Text>
        <Text>• Letters that already arrived stay with their recipients, without your account attached.</Text>
        <Text>• Letters sent to you are removed from your mailbox. Ones still waiting will not be delivered.</Text>
        <Text>• This can’t be undone.</Text>
      </Card>
      {premium && Platform.OS === 'android' && (
        <Section>
          <Notice tone="warning" title="Cancel your subscription first" message="Deleting your account doesn’t stop Google Play billing. Please cancel Plus in Google Play." action={{ label: 'Open Google Play subscriptions', onPress: openManageSubscriptions }} />
        </Section>
      )}
      <Section>
        <View style={{ gap: space.md }}>
          <TextField label='Type "DELETE" to confirm' value={confirm} onChangeText={setConfirm} autoCapitalize="characters" />
          {error && <Notice tone="error" message={error} />}
          <Button label="Permanently delete my account" variant="danger" disabled={confirm !== 'DELETE'} loading={busy} onPress={remove} />
        </View>
      </Section>
    </Screen>
  );
}
