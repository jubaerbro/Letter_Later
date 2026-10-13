import { forwardRef, useState } from 'react';
import { TextInput, View, type TextInputProps } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import { fonts, radius, space } from '@/theme/tokens';
import { Text } from './Text';

export interface TextFieldProps extends TextInputProps {
  label: string;
  helper?: string;
  error?: string | null;
  counter?: { max: number };
  variant?: 'field' | 'paper';
}

export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
  { label, helper, error, counter, variant = 'field', style, multiline, value, ...rest },
  ref,
) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);
  const paper = variant === 'paper';
  return (
    <View style={{ gap: space.xs }}>
      <Text variant="caption" color="inkSoft" nativeID={`${label}-label`}>
        {label}
      </Text>
      <TextInput
        ref={ref}
        value={value}
        accessibilityLabel={label}
        accessibilityHint={helper}
        placeholderTextColor={colors.muted}
        selectionColor={colors.primary}
        multiline={multiline}
        onFocus={(e) => {
          setFocused(true);
          rest.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          rest.onBlur?.(e);
        }}
        style={[
          {
            minHeight: multiline ? 120 : 50,
            borderRadius: radius.md,
            paddingHorizontal: space.lg,
            paddingVertical: space.md,
            borderWidth: 1.5,
            borderColor: error ? colors.danger : focused ? colors.primary : colors.border,
            backgroundColor: paper ? colors.paper : colors.surface,
            color: paper ? '#2C3829' : colors.ink,
            fontFamily: paper ? fonts.displayRegular : fonts.body,
            fontSize: paper ? 18 : 16,
            lineHeight: paper ? 28 : 22,
            textAlignVertical: multiline ? 'top' : 'center',
          },
          style,
        ]}
        {...rest}
      />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.sm }}>
        <Text variant="small" color={error ? 'danger' : 'muted'} style={{ flex: 1 }} accessibilityLiveRegion={error ? 'polite' : 'none'}>
          {error ?? helper ?? ''}
        </Text>
        {counter && (
          <Text variant="small" color={(value?.length ?? 0) > counter.max ? 'danger' : 'muted'}>
            {value?.length ?? 0}/{counter.max}
          </Text>
        )}
      </View>
    </View>
  );
});
