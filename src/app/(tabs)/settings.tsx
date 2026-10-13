import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Linking, Platform, Pressable, Share, View } from 'react-native';
import { Card, Divider, Row, Screen, Section, Segmented, ToggleRow } from '@/components/ui/Layout';
import { Text } from '@/components/ui/Text';
import { updateProfile } from '@/lib/api';
import { config } from '@/lib/config';
import { clearLocalLetterData } from '@/lib/localLetters';
import { unregisterPush } from '@/lib/notifications';
import { getPref, setPref } from '@/lib/prefs';
import { openManageSubscriptions, resetPurchasesUser } from '@/lib/purchases';
import { useSession } from '@/lib/session';
import { useTheme, type ThemePreference } from '@/theme/ThemeProvider';
import { space } from '@/theme/tokens';

export default function Settings() {
  const { colors, preference, setPreference } = useTheme();
  const { profile, session, premium, refresh, signOut } = useSession();
  const [treesOn, setTreesOn] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    getPref('treeExperience').then(setTreesOn);
  }, []);

  if (!profile) return null;
  const address = `@${profile.handle}`;

  const toggle = async (patch: Parameters<typeof updateProfile>[1]) => {
    await updateProfile(profile.id, patch).catch(() => Alert.alert('Couldn’t save that', 'Please try again.'));
    await refresh();
  };

  const doSignOut = async () => {
    await unregisterPush();
    await resetPurchasesUser();
    await clearLocalLetterData();
    await signOut();
  };

  return (
    <Screen>
      <Text variant="title">You</Text>

      <Card style={{ marginTop: space.lg, gap: space.xs }}>
        <Text variant="caption" color="muted">YOUR PERSONAL ADDRESS</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Your address is ${address}. Tap to share.`}
          onPress={async () => {
            if (Platform.OS === 'web') {
              await Clipboard.setStringAsync(address);
              setCopied(true);
            } else {
              Share.share({ message: `Write me a letter on Letter Later: ${address}` });
            }
          }}
        >
          <Text variant="title" selectable>{address}</Text>
        </Pressable>
        <Text variant="small" color="inkSoft">{copied ? 'Copied.' : 'Share it with people you’d like letters from. It isn’t listed anywhere.'}</Text>
        <Text variant="small" color="muted">{profile.display_name} · {session?.user.email}</Text>
      </Card>

      <Section title="Letters">
        <Row icon="pen" label="Personal address & name" detail="Change your address or display name" onPress={() => router.push('/account/profile')} />
        <ToggleRow icon="user" label="Allow letters to my address" detail="Turn off to receive letters only by email" value={profile.accepts_letters_by_handle} onChange={(v) => toggle({ accepts_letters_by_handle: v })} />
        <ToggleRow
          icon="garden"
          label="Show trees"
          detail="Turn off for a simple countdown view"
          value={treesOn}
          onChange={(v) => {
            setTreesOn(v);
            setPref('treeExperience', v);
          }}
        />
      </Section>

      <Section title="Notifications">
        <ToggleRow icon="bell" label="Push notifications" detail="Arrivals, acceptances and openings" value={profile.notify_push} onChange={(v) => toggle({ notify_push: v })} />
        <ToggleRow icon="mailbox" label="Email updates" detail="A note when a letter arrives or is accepted" value={profile.notify_email} onChange={(v) => toggle({ notify_email: v })} />
      </Section>

      <Section title="Appearance">
        <Segmented<ThemePreference>
          value={preference}
          onChange={setPreference}
          options={[
            { value: 'system', label: 'Automatic' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
        />
        <Text variant="small" color="muted" style={{ marginTop: space.sm }}>Animations follow your device’s “reduce motion” setting.</Text>
      </Section>

      <Section title="Letter Later Plus">
        <Row icon="sparkle" label={premium ? 'You have Plus — thank you' : 'Discover Plus'} detail={premium ? 'Faster tree growth and every tree style' : 'Lusher trees and magical styles'} onPress={() => router.push('/premium')} />
        {premium && Platform.OS === 'android' && <Row icon="settings" label="Manage subscription" detail="In Google Play" onPress={openManageSubscriptions} />}
      </Section>

      <Section title="Safety & privacy">
        <Row icon="shield" label="Blocked senders" onPress={() => router.push('/account/blocked')} />
        <Row icon="lock" label="Sign-in & security" detail="Password, sessions" onPress={() => router.push('/account/security')} />
        <Row icon="file" label="Privacy policy" onPress={() => router.push('/legal/privacy')} />
        <Row icon="file" label="Terms" onPress={() => router.push('/legal/terms')} />
        <Row icon="mailbox" label="Contact support" detail={config.supportEmail} onPress={() => Linking.openURL(`mailto:${config.supportEmail}`)} />
      </Section>

      <Section>
        <Card tone="sunken" style={{ gap: 0, padding: space.sm }}>
          <Row icon="back" label="Sign out" onPress={doSignOut} />
          <Divider />
          <Row icon="trash" label="Delete account" detail="Permanently remove your account and data" destructive onPress={() => router.push('/account/delete')} />
        </Card>
      </Section>

      <View style={{ alignItems: 'center', marginTop: space.xl }}>
        <Text variant="caption" color="muted">Letter Later · made with care</Text>
      </View>
      <View style={{ height: 1, backgroundColor: colors.background }} />
    </Screen>
  );
}
