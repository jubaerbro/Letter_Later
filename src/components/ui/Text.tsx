import { Text as RNText, type TextProps } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import { type as typeScale, type Colors, type TypeVariant } from '@/theme/tokens';

type ColorKey = { [K in keyof Colors]: Colors[K] extends string ? K : never }[keyof Colors];

export interface AppTextProps extends TextProps {
  variant?: TypeVariant;
  color?: ColorKey;
  center?: boolean;
}

/** Typography that respects the user's font size settings (capped where layout is tight). */
export function Text({ variant = 'body', color = 'ink', center, style, maxFontSizeMultiplier, ...rest }: AppTextProps) {
  const { colors } = useTheme();
  const heading = variant === 'hero' || variant === 'title' || variant === 'heading';
  return (
    <RNText
      accessibilityRole={heading ? 'header' : undefined}
      maxFontSizeMultiplier={maxFontSizeMultiplier ?? (variant === 'hero' || variant === 'number' ? 1.4 : 2)}
      style={[typeScale[variant], { color: colors[color] }, center && { textAlign: 'center' }, style]}
      {...rest}
    />
  );
}
