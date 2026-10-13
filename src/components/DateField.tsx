import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Platform, View } from 'react-native';
import type { WallTime } from '@shared/domain/time.ts';
import { space } from '@/theme/tokens';
import { Button } from './ui/Button';

/** Native date + time pickers. The picked local reading is treated as wall time in the chosen zone. */
export function DateField({ value, onChange }: { value: WallTime | null; onChange: (w: WallTime) => void }) {
  const [fallback] = useState(() => new Date(Date.now() + 7 * 86_400_000));
  const [limits] = useState(() => {
    const max = new Date();
    max.setFullYear(max.getFullYear() + 50);
    return { min: new Date(), max };
  });
  const base = value ? new Date(value.year, value.month - 1, value.day, value.hour, value.minute) : fallback;
  const [iosMode, setIosMode] = useState<'date' | 'time' | null>(null);
  const { min, max } = limits;

  const apply = (d: Date | undefined, keep: 'date' | 'time') => {
    if (!d) return;
    const current = value ?? { year: base.getFullYear(), month: base.getMonth() + 1, day: base.getDate(), hour: 9, minute: 0 };
    onChange(
      keep === 'date'
        ? { ...current, year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() }
        : { ...current, hour: d.getHours(), minute: d.getMinutes() },
    );
  };

  const open = (mode: 'date' | 'time') => {
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: base,
        mode,
        is24Hour: true,
        minimumDate: mode === 'date' ? min : undefined,
        maximumDate: mode === 'date' ? max : undefined,
        onChange: (event, d) => {
          if (event.type === 'set') apply(d, mode);
        },
      });
    } else {
      setIosMode(mode);
    }
  };

  return (
    <View style={{ gap: space.sm }}>
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <Button label="Choose date" icon="calendar" variant="secondary" style={{ flex: 1 }} onPress={() => open('date')} />
        <Button label="Choose time" icon="clock" variant="secondary" style={{ flex: 1 }} onPress={() => open('time')} />
      </View>
      {iosMode && (
        <DateTimePicker
          value={base}
          mode={iosMode}
          display="spinner"
          minimumDate={iosMode === 'date' ? min : undefined}
          maximumDate={iosMode === 'date' ? max : undefined}
          onChange={(_, d) => apply(d, iosMode)}
        />
      )}
    </View>
  );
}
