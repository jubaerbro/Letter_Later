import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { Tree } from '@/components/tree/Tree';
import { Button, IconButton } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Card, Notice, Screen, Section } from '@/components/ui/Layout';
import { Text } from '@/components/ui/Text';
import { ApiError } from '@/lib/api';
import { isUserCancelled, loadPlans, openManageSubscriptions, purchase, purchasesAvailable, restore, type PlanOption } from '@/lib/purchases';
import { useSession } from '@/lib/session';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';

const PERKS = [
  'Your care counts double — trees grow lusher, faster',
  'Every tree style, including Lantern and Starlight',
  'A soft glow for your whole garden',
  'Support a small, ad-free app',
];

export default function Premium() {
  const { colors } = useTheme();
  const { premium, setPremium } = useSession();
  const [plans, setPlans] = useState<PlanOption[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'error' | 'success' | 'info'; text: string } | null>(null);
  const available = purchasesAvailable();

  useEffect(() => {
    if (!available) return;
    loadPlans()
      .then((p) => {
        setPlans(p);
        setSelected(p.find((x) => x.title === 'Yearly')?.id ?? p[0]?.id ?? null);
      })
      .catch(() => setMessage({ tone: 'error', text: 'We couldn’t load plans from Google Play right now.' }));
  }, [available]);

  const buy = async () => {
    const plan = plans.find((p) => p.id === selected);
    if (!plan) return;
    setBusy(true);
    setMessage(null);
    try {
      const ok = await purchase(plan);
      setPremium(ok);
      setMessage(ok ? { tone: 'success', text: 'Welcome to Plus. Your trees thank you.' } : { tone: 'info', text: 'Your purchase is being confirmed. It can take a minute.' });
    } catch (e) {
      if (!isUserCancelled(e)) setMessage({ tone: 'error', text: e instanceof ApiError ? e.message : 'The purchase didn’t go through. You haven’t been charged.' });
    } finally {
      setBusy(false);
    }
  };

  const doRestore = async () => {
    setBusy(true);
    try {
      const ok = await restore();
      setPremium(ok);
      setMessage(ok ? { tone: 'success', text: 'Plus restored.' } : { tone: 'info', text: 'No active Plus subscription found for this Google account.' });
    } catch {
      setMessage({ tone: 'error', text: 'Couldn’t restore purchases right now.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen gradient="dawn">
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
        <IconButton icon="close" label="Close" onPress={() => router.back()} />
      </View>
      <View style={{ alignItems: 'center', gap: space.md }}>
        <Tree stage="bloom" growth={1} style="starlight" size={180} />
        <Text variant="hero" center>Letter Later Plus</Text>
        <Text color="inkSoft" center>A little extra magic for your garden.</Text>
      </View>

      <Card style={{ marginTop: space.xl, gap: space.md }}>
        {PERKS.map((p) => (
          <View key={p} style={{ flexDirection: 'row', gap: space.md, alignItems: 'center' }}>
            <Icon name="sparkle" color={colors.gold} />
            <Text style={{ flex: 1 }}>{p}</Text>
          </View>
        ))}
      </Card>

      <Section>
        <Notice title="It never changes when letters open" message="Plus only changes how your trees look. Every letter still opens exactly on the date its sender chose." />
      </Section>

      {premium ? (
        <Section>
          <Text variant="heading" center>You have Plus 🌿</Text>
          {Platform.OS === 'android' && <Button label="Manage in Google Play" variant="secondary" style={{ marginTop: space.md }} onPress={openManageSubscriptions} />}
        </Section>
      ) : !available ? (
        <Section>
          <Notice message={Platform.OS === 'web' ? 'Plus is available in the Android app.' : 'Purchases aren’t set up in this build yet.'} />
        </Section>
      ) : (
        <Section>
          <View style={{ gap: space.sm }}>
            {plans.map((p) => (
              <Pressable
                key={p.id}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected === p.id }}
                accessibilityLabel={`${p.title}, ${p.price} ${p.period}`}
                onPress={() => setSelected(p.id)}
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: space.lg, borderRadius: radius.lg, borderWidth: 2, borderColor: selected === p.id ? colors.primary : colors.border, backgroundColor: colors.surface }}
              >
                <Text variant="bodyStrong">{p.title}</Text>
                <Text variant="bodyStrong">{p.price} <Text variant="small" color="inkSoft">{p.period}</Text></Text>
              </Pressable>
            ))}
            <Button label="Continue" size="lg" loading={busy} disabled={!selected} onPress={buy} />
            <Button label="Restore purchases" variant="ghost" onPress={doRestore} />
            <Text variant="small" color="muted" center>
              Billed through Google Play. Renews automatically at the price shown until cancelled. Cancel anytime in Google Play → Subscriptions, at least 24 hours before renewal.
            </Text>
          </View>
        </Section>
      )}

      {message && <Section><Notice tone={message.tone} message={message.text} /></Section>}

      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: space.lg, marginTop: space.lg }}>
        <Text variant="small" color="primary" onPress={() => router.push('/legal/terms')}>Terms</Text>
        <Text variant="small" color="primary" onPress={() => router.push('/legal/privacy')}>Privacy</Text>
      </View>
    </Screen>
  );
}
