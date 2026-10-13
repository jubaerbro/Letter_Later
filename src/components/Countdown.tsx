import { useEffect, useState } from 'react';
import { AppState, View } from 'react-native';
import { countdown, describeCountdown } from '@shared/domain/time.ts';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';
import { Text } from './ui/Text';

/** Re-renders every second only in the final hour; otherwise once a minute. Pauses in background. */
export function useNow(target: Date) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let active = AppState.currentState !== 'background';
    const tick = () => {
      const n = new Date();
      setNow(n);
      const remaining = target.getTime() - n.getTime();
      if (!active || remaining <= 0) return;
      timer = setTimeout(tick, remaining < 3_600_000 ? 1000 : 60_000 - (n.getTime() % 60_000));
    };
    tick();
    const sub = AppState.addEventListener('change', (s) => {
      const wasActive = active;
      active = s === 'active';
      if (active && !wasActive) tick();
      if (!active && timer) clearTimeout(timer);
    });
    return () => {
      if (timer) clearTimeout(timer);
      sub.remove();
    };
  }, [target]);
  return now;
}

export function Countdown({ deliverAt, compact }: { deliverAt: string; compact?: boolean }) {
  const { colors } = useTheme();
  const target = new Date(deliverAt);
  const now = useNow(target);
  const c = countdown(target, now);
  const phrase = describeCountdown(c);

  if (compact) {
    return (
      <Text variant="small" color="inkSoft" accessibilityLabel={`Opens ${phrase}`}>
        {c.done ? 'Ready to open' : `Opens ${phrase}`}
      </Text>
    );
  }

  const units: [number, string][] = c.years > 0
    ? [[c.years, c.years === 1 ? 'year' : 'years'], [c.days, 'days'], [c.hours, 'hours']]
    : c.days > 0
      ? [[c.days, c.days === 1 ? 'day' : 'days'], [c.hours, 'hours'], [c.minutes, 'min']]
      : [[c.hours, 'hours'], [c.minutes, 'min'], [c.seconds, 'sec']];

  return (
    <View accessible accessibilityRole="timer" accessibilityLabel={c.done ? 'Ready to open' : `Opens ${phrase}`} style={{ flexDirection: 'row', gap: space.sm, justifyContent: 'center' }}>
      {c.done ? (
        <Text variant="heading" color="primary">
          Ready to open
        </Text>
      ) : (
        units.map(([n, label]) => (
          <View key={label} style={{ alignItems: 'center', minWidth: 74, paddingVertical: space.sm, paddingHorizontal: space.md, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border }}>
            <Text variant="number">{String(n).padStart(label === 'years' || label === 'year' ? 1 : 2, '0')}</Text>
            <Text variant="caption" color="muted">
              {label}
            </Text>
          </View>
        ))
      )}
    </View>
  );
}
