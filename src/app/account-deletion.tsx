import { router } from 'expo-router';
import { Linking, View } from 'react-native';
import { Button } from '@/components/ui/Button';
import { Card, Header, Screen, Section } from '@/components/ui/Layout';
import { Text } from '@/components/ui/Text';
import { config } from '@/lib/config';
import { useSession } from '@/lib/session';
import { space } from '@/theme/tokens';

/**
 * Public page for Google Play's "account deletion URL" requirement:
 * https://<WEB_BASE_URL>/account-deletion
 */
export default function AccountDeletionInfo() {
  const { session, profile } = useSession();
  return (
    <Screen>
      <Header onBack={router.canGoBack() ? () => router.back() : undefined} title="Delete your LaterLetter account" />
      <Card style={{ gap: space.sm }}>
        <Text variant="bodyStrong">In the app</Text>
        <Text color="inkSoft">Open LaterLetter → You → Delete account, then type DELETE to confirm.</Text>
        <Text variant="bodyStrong" style={{ marginTop: space.sm }}>On the web</Text>
        <Text color="inkSoft">Sign in on this website and follow the same steps.</Text>
      </Card>
      <Section title="What is deleted">
        <Text color="inkSoft">
          Your profile, personal address, trees, notification settings, push tokens and subscription status are deleted immediately. Letters you sent that haven’t arrived are cancelled and erased. Letters already delivered stay with their recipients without your account attached. Letters addressed to you are removed from your mailbox. Encrypted backups are overwritten within our hosting provider’s backup retention period.
        </Text>
      </Section>
      <Section>
        <View style={{ gap: space.sm }}>
          {session && profile?.onboarded_at ? (
            <Button label="Continue to delete my account" variant="danger" onPress={() => router.push('/account/delete')} />
          ) : (
            <Button label="Sign in to delete" onPress={() => router.push('/sign-in')} />
          )}
          <Button label={`Can’t sign in? Email ${config.supportEmail}`} variant="ghost" onPress={() => Linking.openURL(`mailto:${config.supportEmail}?subject=Account%20deletion%20request`)} />
        </View>
      </Section>
    </Screen>
  );
}
