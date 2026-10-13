import AsyncStorage from '@react-native-async-storage/async-storage';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Countdown } from '@/components/Countdown';
import { Envelope } from '@/components/Envelope';
import { Tree } from '@/components/tree/Tree';
import { Button } from '@/components/ui/Button';
import { Card, Header, Notice, Screen, Section } from '@/components/ui/Layout';
import { Text } from '@/components/ui/Text';
import { ApiError, claimInvitation, invitationPreview, type InvitationPreview } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { PENDING_CLAIM_KEY } from '@/lib/localLetters';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { space } from '@/theme/tokens';

/**
 * Landing page for invitation links (app and web). Shows the envelope the sender chose to
 * reveal and a real countdown, explains the app, then asks the person to verify the invited
 * email. Ownership is checked on the server: the signed-in, verified email must match.
 */
export default function Claim() {
  const { token } = useLocalSearchParams<{ token?: string }>();
  const { session, profile } = useSession();
  const [preview, setPreview] = useState<InvitationPreview | null>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const signedIn = !!session;
  const ready = signedIn && !!profile?.onboarded_at;

  useEffect(() => {
    if (!token) return;
    invitationPreview(token)
      .then(setPreview)
      .catch((e) => setError(e instanceof ApiError ? { code: e.code, message: e.message } : { code: 'unknown', message: 'Something went wrong.' }));
  }, [token]);

  const claim = async () => {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const r = await claimInvitation(token);
      router.replace(`/letter/${r.letter_id}`);
    } catch (e) {
      setError(e instanceof ApiError ? { code: e.code, message: e.message } : { code: 'unknown', message: 'Something went wrong.' });
    } finally {
      setBusy(false);
    }
  };

  const startSignIn = async () => {
    if (token) await AsyncStorage.setItem(PENDING_CLAIM_KEY, token).catch(() => {});
    router.push('/sign-in');
  };

  const from = preview?.sender_name ?? 'Someone';
  const shownError = error ?? (!token ? { code: 'invalid', message: new ApiError('invalid').message } : null);

  return (
    <Screen gradient="dawn">
      <Header onBack={router.canGoBack() ? () => router.back() : undefined} />
      {!preview && !shownError && <Text color="inkSoft">Finding your letter…</Text>}

      {preview && (
        <View style={{ alignItems: 'center', gap: space.lg }}>
          <Envelope width={240} initial={preview.sender_name?.[0]} />
          <Text variant="hero" center>
            {preview.sender_name ? `${from} wrote you a letter` : 'Someone wrote you a letter'}
          </Text>
          {preview.subject && <Text variant="heading" center>“{preview.subject}”</Text>}
          {preview.preview && <Text color="inkSoft" center style={{ fontStyle: 'italic' }}>{preview.preview}</Text>}
          {preview.arrived ? (
            <Notice title="It has arrived" message="The waiting is over. Claim your mailbox to open it." />
          ) : (
            <>
              <Text variant="small" color="inkSoft" center>It’s sealed until {formatDateTime(preview.deliver_at)}</Text>
              <Countdown deliverAt={preview.deliver_at} />
            </>
          )}
        </View>
      )}

      {preview && !preview.claimed && (
        <Section>
          <Card style={{ gap: space.md, alignItems: 'center' }}>
            <Tree stage="sprout" growth={0.2} size={130} sway={false} halo />
            <Text variant="heading" center>What is LaterLetter?</Text>
            <Text color="inkSoft" center>
              A calm place for letters that arrive in the future. While you wait, you’ll grow a little tree for this letter — and {preview.sender_name ? from : 'they'} will see it grow too. It’s free, with no ads.
            </Text>
          </Card>
        </Section>
      )}

      <Section>
        {shownError && (
          <View style={{ marginBottom: space.md }}>
            <Notice tone="error" message={shownError.message} />
          </View>
        )}
        {preview && !preview.claimed && (
          <View style={{ gap: space.sm }}>
            {ready ? (
              <Button label="Claim this letter" size="lg" loading={busy} onPress={claim} />
            ) : signedIn ? (
              <Notice message="Finish setting up your garden first, then we’ll bring you right back to this letter." />
            ) : (
              <>
                <Button label="Claim your mailbox" size="lg" onPress={startSignIn} />
                <Text variant="small" color="muted" center>
                  Sign in with the address this was sent to ({preview.email_hint}). We’ll email you a code to confirm it’s really you.
                </Text>
              </>
            )}
            {signedIn && error?.code === 'email_mismatch' && (
              <Button
                label="Use a different email"
                variant="secondary"
                onPress={async () => {
                  if (token) await AsyncStorage.setItem(PENDING_CLAIM_KEY, token).catch(() => {});
                  await supabase.auth.signOut();
                }}
              />
            )}
          </View>
        )}
        {preview?.claimed && (
          <Notice message="This letter has already been claimed. If it was you, it’s waiting in your mailbox." action={signedIn ? { label: 'Go to my garden', onPress: () => router.replace('/') } : { label: 'Sign in', onPress: startSignIn }} />
        )}
        <Text variant="small" color="muted" center style={{ marginTop: space.lg }}>
          Not expecting this? You can simply ignore it. Letters can be reported, and senders can be blocked at any time.
        </Text>
      </Section>
    </Screen>
  );
}
