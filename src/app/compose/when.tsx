import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { DateField } from '@/components/DateField';
import { TimeZonePicker } from '@/components/TimeZonePicker';
import { Button } from '@/components/ui/Button';
import { Card, Header, Notice, Screen, Section } from '@/components/ui/Layout';
import { Text } from '@/components/ui/Text';
import { useCompose } from '@/lib/compose';
import { formatDateTime } from '@/lib/format';
import { countdown, describeCountdown, validateDeliveryInstant, wallTimeOf, type WallTime } from '@shared/domain/time.ts';
import { friendlyMessage } from '@shared/domain/messages.ts';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';

function presetFrom(timeZone: string, add: { days?: number; months?: number; years?: number }): WallTime {
  const now = wallTimeOf(new Date(), timeZone);
  const d = new Date(Date.UTC(now.year + (add.years ?? 0), now.month - 1 + (add.months ?? 0), now.day + (add.days ?? 0)));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: 9, minute: 0 };
}

const PRESETS: { label: string; add: { days?: number; months?: number; years?: number } }[] = [
  { label: 'Tomorrow morning', add: { days: 1 } },
  { label: 'In a month', add: { months: 1 } },
  { label: 'In a year', add: { years: 1 } },
  { label: 'In 5 years', add: { years: 5 } },
  { label: 'In 10 years', add: { years: 10 } },
];

export default function ComposeWhen() {
  const { colors } = useTheme();
  const { draft, update, instant } = useCompose();
  const [error, setError] = useState<string | null>(null);

  const problem = instant ? validateDeliveryInstant(instant.instant, new Date(), { minLeadSeconds: 3600, maxYears: 50 }) : null;

  const next = () => {
    if (!draft.when || !instant) return setError('Choose a date and time for your letter to open.');
    if (problem === 'too_soon') return setError(friendlyMessage('deliver_at_too_soon') + ' (at least an hour from now)');
    if (problem === 'too_far') return setError(friendlyMessage('deliver_at_too_far'));
    if (problem === 'invalid') return setError(friendlyMessage('invalid_wall_time'));
    setError(null);
    router.push('/compose/reveal');
  };

  return (
    <Screen footer={<Button label="Choose what they see" size="lg" onPress={next} />}>
      <Header onBack={() => router.back()} title="When should it open?" subtitle="Choose a moment worth waiting for." />

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        {PRESETS.map((p) => (
          <Pressable
            key={p.label}
            accessibilityRole="button"
            onPress={() => update({ when: presetFrom(draft.timeZone, p.add) })}
            style={{ paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}
          >
            <Text variant="small">{p.label}</Text>
          </Pressable>
        ))}
      </View>

      <Section title="Or pick exactly">
        <DateField value={draft.when} onChange={(w) => update({ when: w })} />
      </Section>

      <Section title="In this time zone">
        <TimeZonePicker value={draft.timeZone} onChange={(tz) => update({ timeZone: tz })} />
      </Section>

      {instant && (
        <Card tone="primary" style={{ marginTop: space.xl, gap: space.xs }}>
          <Text variant="caption" color="inkSoft">
            IT WILL OPEN
          </Text>
          <Text variant="heading">{formatDateTime(instant.instant, draft.timeZone)}</Text>
          {!problem && (
            <Text variant="small" color="inkSoft">
              That’s {describeCountdown(countdown(instant.instant, new Date()))}. The same moment everywhere in the world.
            </Text>
          )}
        </Card>
      )}

      {instant?.resolution === 'shifted_forward' && (
        <View style={{ marginTop: space.md }}>
          <Notice tone="warning" message="The clocks jump forward at that moment, so that exact time doesn’t exist. We moved it to the first moment after the change." />
        </View>
      )}
      {instant?.resolution === 'ambiguous' && (
        <View style={{ marginTop: space.md }}>
          <Notice tone="warning" message="The clocks go back that night, so this time happens twice. We’ll use the first one." />
        </View>
      )}
      {(error || problem) && (
        <View style={{ marginTop: space.md }}>
          <Notice tone="error" message={error ?? (problem === 'too_soon' ? 'Please choose a time at least an hour from now.' : friendlyMessage(problem === 'too_far' ? 'deliver_at_too_far' : 'invalid_wall_time'))} />
        </View>
      )}
    </Screen>
  );
}
