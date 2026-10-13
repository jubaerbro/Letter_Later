import { useState } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-worklets';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * Minimal accessible slider (seek / volume). Supports drag and tap, and the screen-reader
 * "adjustable" role with increment/decrement actions.
 */
export function Slider({ value, max = 1, onChange, label, step, format }: { value: number; max?: number; onChange: (v: number) => void; label: string; step?: number; format?: (v: number) => string }) {
  const { colors } = useTheme();
  const [width, setWidth] = useState(0);
  const [dragging, setDragging] = useState<number | null>(null);
  const shown = dragging ?? value;
  const fraction = max > 0 ? Math.min(1, Math.max(0, shown / max)) : 0;
  const delta = step ?? max / 20;

  const toValue = (x: number) => Math.min(max, Math.max(0, (x / Math.max(1, width)) * max));
  const commit = (x: number) => {
    setDragging(null);
    onChange(toValue(x));
  };
  const preview = (x: number) => setDragging(toValue(x));

  const pan = Gesture.Pan()
    .onUpdate((e) => runOnJS(preview)(e.x))
    .onEnd((e) => runOnJS(commit)(e.x));
  const tap = Gesture.Tap().onEnd((e) => runOnJS(commit)(e.x));

  return (
    <GestureDetector gesture={Gesture.Race(pan, tap)}>
      <View
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityValue={{ text: format ? format(shown) : `${Math.round(fraction * 100)}%` }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => onChange(Math.min(max, Math.max(0, value + (e.nativeEvent.actionName === 'increment' ? delta : -delta))))}
        onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
        style={{ height: 32, justifyContent: 'center' }}
      >
        <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.surfaceSunken }}>
          <View style={{ width: fraction * width, height: 6, borderRadius: 3, backgroundColor: colors.primary }} />
        </View>
        <View style={{ position: 'absolute', left: Math.max(0, fraction * width - 9), width: 18, height: 18, borderRadius: 9, backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.primary }} />
      </View>
    </GestureDetector>
  );
}
