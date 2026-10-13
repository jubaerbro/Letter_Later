import { createElement } from 'react';
import { View } from 'react-native';
import type { WallTime } from '@shared/domain/time.ts';
import { useTheme } from '@/theme/ThemeProvider';
import { space } from '@/theme/tokens';

const pad = (n: number) => String(n).padStart(2, '0');

/** Web uses the browser's own date/time inputs. */
export function DateField({ value, onChange }: { value: WallTime | null; onChange: (w: WallTime) => void }) {
  const { colors } = useTheme();
  const current = value ?? { year: new Date().getFullYear(), month: new Date().getMonth() + 1, day: new Date().getDate() + 7, hour: 9, minute: 0 };
  const style = {
    flex: 1,
    padding: 12,
    borderRadius: 14,
    border: `1.5px solid ${colors.border}`,
    background: colors.surface,
    color: colors.ink,
    fontSize: 16,
    fontFamily: 'inherit',
  };
  return (
    <View style={{ flexDirection: 'row', gap: space.sm }}>
      {createElement('input', {
        type: 'date',
        'aria-label': 'Opening date',
        value: value ? `${value.year}-${pad(value.month)}-${pad(value.day)}` : '',
        min: new Date().toISOString().slice(0, 10),
        style,
        onChange: (e: { target: { value: string } }) => {
          const [y, m, d] = e.target.value.split('-').map(Number);
          if (y && m && d) onChange({ ...current, year: y, month: m, day: d });
        },
      })}
      {createElement('input', {
        type: 'time',
        'aria-label': 'Opening time',
        value: value ? `${pad(value.hour)}:${pad(value.minute)}` : '',
        style,
        onChange: (e: { target: { value: string } }) => {
          const [h, min] = e.target.value.split(':').map(Number);
          if (Number.isInteger(h) && Number.isInteger(min)) onChange({ ...current, hour: h, minute: min });
        },
      })}
    </View>
  );
}
