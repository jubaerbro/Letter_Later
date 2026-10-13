import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Button } from '@/components/ui/Button';
import { Header, Notice, Screen } from '@/components/ui/Layout';
import { Text } from '@/components/ui/Text';
import { TextField } from '@/components/ui/TextField';
import { supabase } from '@/lib/supabase';
import { isValidEmail, normalizeEmail } from '@shared/domain/validation.ts';
import { space } from '@/theme/tokens';

type Step = 'email' | 'code' | 'password';

function authMessage(message: string) {
  if (/rate|too many|security purposes/i.test(message)) return 'Let’s pause a moment — please wait a minute before asking for another code.';
  if (/expired|invalid/i.test(message)) return 'That code didn’t work. It may have expired — you can ask for a new one.';
  if (/credentials/i.test(message)) return 'That email and password don’t match.';
  if (/network|fetch/i.test(message)) return 'We couldn’t reach the garden. Check your connection and try again.';
  return 'Something went wrong. Please try again.';
}

export default function SignIn() {
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown(cooldown - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const sendCode = async () => {
    setError(null);
    if (!isValidEmail(email)) return setError('Please enter a valid email address.');
    setBusy(true);
    const { error: e } = await supabase.auth.signInWithOtp({ email: normalizeEmail(email), options: { shouldCreateUser: true } });
    setBusy(false);
    if (e) return setError(authMessage(e.message));
    setStep('code');
    setCooldown(60);
  };

  const verify = async () => {
    setError(null);
    setBusy(true);
    const { error: e } = await supabase.auth.verifyOtp({ email: normalizeEmail(email), token: code.trim(), type: 'email' });
    setBusy(false);
    if (e) setError(authMessage(e.message));
    // On success the session listener moves us to onboarding or the garden.
  };

  const withPassword = async () => {
    setError(null);
    setBusy(true);
    const { error: e } = await supabase.auth.signInWithPassword({ email: normalizeEmail(email), password });
    setBusy(false);
    if (e) setError(authMessage(e.message));
  };

  return (
    <Screen gradient="dawn">
      <Header onBack={() => (step === 'email' ? router.back() : setStep('email'))} title={step === 'code' ? 'Check your email' : 'Welcome'} subtitle={
        step === 'code'
          ? `We sent a 6-digit code to ${normalizeEmail(email)}. It keeps your mailbox yours.`
          : 'Sign in or create your mailbox with your email. No password needed.'
      } />

      <View style={{ gap: space.lg }}>
        {step !== 'code' && (
          <TextField
            label="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            textContentType="emailAddress"
            returnKeyType="next"
            onSubmitEditing={step === 'email' ? sendCode : undefined}
          />
        )}
        {step === 'code' && (
          <TextField
            label="6-digit code"
            value={code}
            onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 6))}
            keyboardType="number-pad"
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
            maxLength={6}
            style={{ fontSize: 26, letterSpacing: 8, textAlign: 'center' }}
            onSubmitEditing={verify}
          />
        )}
        {step === 'password' && (
          <TextField label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" textContentType="password" onSubmitEditing={withPassword} />
        )}

        {error && <Notice tone="error" message={error} />}

        {step === 'email' && <Button label="Email me a code" size="lg" loading={busy} onPress={sendCode} />}
        {step === 'code' && (
          <>
            <Button label="Continue" size="lg" loading={busy} disabled={code.length !== 6} onPress={verify} />
            <Button label={cooldown > 0 ? `Send a new code in ${cooldown}s` : 'Send a new code'} variant="ghost" disabled={cooldown > 0} onPress={sendCode} />
          </>
        )}
        {step === 'password' && <Button label="Sign in" size="lg" loading={busy} disabled={!password} onPress={withPassword} />}

        {step !== 'code' && (
          <Pressable accessibilityRole="button" onPress={() => setStep(step === 'password' ? 'email' : 'password')} style={{ alignSelf: 'center', padding: space.sm }}>
            <Text variant="small" color="primary">
              {step === 'password' ? 'Use an email code instead' : 'I set a password — use it instead'}
            </Text>
          </Pressable>
        )}

        <Text variant="small" color="muted" center>
          By continuing you agree to our{' '}
          <Text variant="small" color="primary" onPress={() => router.push('/legal/terms')}>
            Terms
          </Text>{' '}
          and{' '}
          <Text variant="small" color="primary" onPress={() => router.push('/legal/privacy')}>
            Privacy Policy
          </Text>
          .
        </Text>
      </View>
    </Screen>
  );
}
