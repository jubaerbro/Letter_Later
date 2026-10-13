import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Header, Notice, Screen } from '@/components/ui/Layout';
import { Text } from '@/components/ui/Text';
import { TextField } from '@/components/ui/TextField';
import { ApiError, resolveRecipient } from '@/lib/api';
import { useAudio } from '@/lib/audio/AudioProvider';
import { useCompose } from '@/lib/compose';
import { useSession } from '@/lib/session';
import { friendlyMessage } from '@shared/domain/messages.ts';
import { draftProblems, LIMITS, parseRecipient } from '@shared/domain/validation.ts';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';

export default function ComposeWrite() {
  const { colors } = useTheme();
  const { session, profile } = useSession();
  const { draft, update, reset, restored } = useCompose();
  const audio = useAudio();
  const params = useLocalSearchParams<{ toSelf?: string }>();
  const [checking, setChecking] = useState(false);
  const [recipientError, setRecipientError] = useState<string | null>(null);
  const [bodyError, setBodyError] = useState<string | null>(null);
  const myEmail = session?.user.email ?? '';

  useEffect(() => {
    if (params.toSelf === '1' && myEmail) update({ recipient: myEmail, isSelf: true, recipientName: 'Future you' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.toSelf, myEmail]);

  const next = async () => {
    setRecipientError(null);
    setBodyError(null);
    const parsed = parseRecipient(draft.recipient);
    if ('error' in parsed) return setRecipientError(friendlyMessage(parsed.error));
    const problems = draftProblems({ subject: draft.subject, body: draft.body });
    if (problems.length) return setBodyError(friendlyMessage(problems[0]));

    if (parsed.kind === 'handle') {
      setChecking(true);
      try {
        const r = await resolveRecipient(parsed.value);
        update({ recipientName: r.display_name, isSelf: r.is_self });
      } catch (e) {
        setChecking(false);
        return setRecipientError(e instanceof ApiError ? (e.code === 'not_found' ? friendlyMessage('recipient_not_found') : e.message) : friendlyMessage('unknown'));
      }
      setChecking(false);
    } else {
      const self = parsed.value === myEmail.toLowerCase();
      update({ isSelf: self, recipientName: self ? 'Future you' : null });
    }
    router.push('/compose/when');
  };

  return (
    <Screen footer={<Button label="Choose when it opens" size="lg" loading={checking} onPress={next} />}>
      <Header
        onBack={() => router.back()}
        title="Write a letter"
        right={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={audio.playing ? 'Pause writing music' : 'Play gentle music while writing'}
            onPress={() => (audio.playing ? audio.pause() : audio.play())}
            style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.pill, backgroundColor: audio.playing ? colors.primarySoft : colors.surfaceSunken }}
          >
            <Icon name="music" size={18} color={audio.playing ? colors.primary : colors.inkSoft} />
            <Text variant="small" color={audio.playing ? 'primary' : 'inkSoft'}>
              {audio.playing ? 'Music on' : 'Music'}
            </Text>
          </Pressable>
        }
      />

      {restored && (
        <View style={{ marginBottom: space.lg }}>
          <Notice message="We kept the letter you were writing." action={{ label: 'Start a fresh one instead', onPress: reset }} />
        </View>
      )}

      <View style={{ gap: space.lg }}>
        <View style={{ gap: space.sm }}>
          <TextField
            label="Who is it for?"
            value={draft.recipient}
            onChangeText={(t) => update({ recipient: t, recipientName: null, isSelf: false })}
            placeholder="Their email, or @their-address"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            error={recipientError}
            helper="They don’t need an account. We’ll invite them gently."
          />
          {myEmail ? (
            <Pressable accessibilityRole="button" onPress={() => update({ recipient: myEmail, isSelf: true, recipientName: 'Future you' })} style={{ alignSelf: 'flex-start', paddingVertical: space.xs }}>
              <Text variant="small" color="primary">
                ✦ Write to future me
              </Text>
            </Pressable>
          ) : null}
        </View>

        <TextField label="Subject (optional)" value={draft.subject} onChangeText={(t) => update({ subject: t })} maxLength={LIMITS.subject} placeholder="For your graduation day" />

        <TextField
          label={`Dear ${draft.isSelf ? 'future me' : (draft.recipientName ?? 'friend')},`}
          variant="paper"
          multiline
          value={draft.body}
          onChangeText={(t) => update({ body: t })}
          placeholder="Write slowly. There’s no rush — this letter will wait."
          style={{ minHeight: 320 }}
          error={bodyError}
          counter={{ max: LIMITS.body }}
          accessibilityHint="Your letter. Only the recipient can read it, on the day it opens."
        />
        <Text variant="small" color="muted">
          Signed, {profile?.display_name ?? 'you'} · Your words are encrypted and sealed until the opening day.
        </Text>
      </View>
    </Screen>
  );
}
