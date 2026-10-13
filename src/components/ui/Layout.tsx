import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Switch, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';
import { IconButton, type ButtonProps } from './Button';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

/** Full screen with safe areas, a soft background and an optional scroll container. */
export function Screen({
  children,
  scroll = true,
  gradient,
  padded = true,
  footer,
  contentStyle,
}: {
  children: ReactNode;
  scroll?: boolean;
  gradient?: 'dawn' | 'meadow';
  padded?: boolean;
  footer?: ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const inner = [
    { paddingHorizontal: padded ? space.xl : 0, paddingBottom: space.xxxl, maxWidth: 680, width: '100%' as const, alignSelf: 'center' as const },
    contentStyle,
  ];
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {gradient && (
        <LinearGradient colors={colors[gradient]} style={StyleSheet.absoluteFill} />
      )}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {scroll ? (
          <ScrollView
            contentContainerStyle={[{ paddingTop: insets.top + space.sm }, ...inner]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {children}
          </ScrollView>
        ) : (
          <View style={[{ flex: 1, paddingTop: insets.top + space.sm }, ...inner]}>{children}</View>
        )}
        {footer && (
          <View style={{ paddingHorizontal: space.xl, paddingBottom: insets.bottom + space.md, paddingTop: space.sm, maxWidth: 680, width: '100%', alignSelf: 'center' }}>
            {footer}
          </View>
        )}
      </KeyboardAvoidingView>
    </View>
  );
}

export function Header({ title, subtitle, onBack, right }: { title?: string; subtitle?: string; onBack?: () => void; right?: ReactNode }) {
  return (
    <View style={{ marginBottom: space.lg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 }}>
        {onBack ? <IconButton icon="back" label="Go back" onPress={onBack} /> : <View />}
        {right}
      </View>
      {title && (
        <Text variant="title" style={{ marginTop: space.xs }}>
          {title}
        </Text>
      )}
      {subtitle && (
        <Text variant="body" color="inkSoft" style={{ marginTop: space.xs }}>
          {subtitle}
        </Text>
      )}
    </View>
  );
}

export function Card({ children, style, onPress, accessibilityLabel, tone = 'surface' }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; accessibilityLabel?: string; tone?: 'surface' | 'sunken' | 'primary' | 'gold' }) {
  const { colors } = useTheme();
  const bg = { surface: colors.surface, sunken: colors.surfaceSunken, primary: colors.primarySoft, gold: colors.goldSoft }[tone];
  const base: ViewStyle = {
    backgroundColor: bg,
    borderRadius: radius.lg,
    padding: space.lg,
    borderWidth: tone === 'surface' ? 1 : 0,
    borderColor: colors.border,
    shadowColor: colors.shadow,
    shadowOpacity: tone === 'surface' ? 1 : 0,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: tone === 'surface' ? 2 : 0,
  };
  if (!onPress) return <View style={[base, style]}>{children}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [base, { transform: [{ scale: pressed ? 0.985 : 1 }] }, style]}
    >
      {children}
    </Pressable>
  );
}

export function Section({ title, children, style }: { title?: string; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ marginTop: space.xl }, style]}>
      {title && (
        <Text variant="caption" color="muted" style={{ marginBottom: space.sm, textTransform: 'uppercase' }}>
          {title}
        </Text>
      )}
      {children}
    </View>
  );
}

export function Row({ icon, label, detail, onPress, destructive, right }: { icon?: IconName; label: string; detail?: string; onPress?: () => void; destructive?: boolean; right?: ReactNode }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={detail ? `${label}, ${detail}` : label}
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        paddingVertical: space.md,
        minHeight: 52,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      {icon && <Icon name={icon} color={destructive ? colors.danger : colors.inkSoft} />}
      <View style={{ flex: 1 }}>
        <Text variant="bodyStrong" color={destructive ? 'danger' : 'ink'}>
          {label}
        </Text>
        {detail && (
          <Text variant="small" color="inkSoft">
            {detail}
          </Text>
        )}
      </View>
      {right ?? (onPress ? <Icon name="chevron" size={18} color={colors.muted} /> : null)}
    </Pressable>
  );
}

export function ToggleRow({ label, detail, value, onChange, icon }: { label: string; detail?: string; value: boolean; onChange: (v: boolean) => void; icon?: IconName }) {
  const { colors } = useTheme();
  return (
    <Row
      icon={icon}
      label={label}
      detail={detail}
      right={
        <Switch
          accessibilityLabel={label}
          value={value}
          onValueChange={onChange}
          trackColor={{ true: colors.primary, false: colors.border }}
          thumbColor={colors.surface}
        />
      }
    />
  );
}

export function Divider() {
  const { colors } = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border }} />;
}

export function Notice({ tone = 'info', title, message, action }: { tone?: 'info' | 'warning' | 'error' | 'success'; title?: string; message: string; action?: Pick<ButtonProps, 'label' | 'onPress'> }) {
  const { colors } = useTheme();
  const bg = { info: colors.primarySoft, warning: colors.goldSoft, error: colors.dangerSoft, success: colors.primarySoft }[tone];
  const icon: IconName = { info: 'sparkle', warning: 'clock', error: 'shield', success: 'check' }[tone] as IconName;
  return (
    <View
      accessibilityRole={tone === 'error' ? 'alert' : 'summary'}
      style={{ backgroundColor: bg, borderRadius: radius.md, padding: space.md, flexDirection: 'row', gap: space.md }}
    >
      <Icon name={icon} color={tone === 'error' ? colors.danger : colors.primary} />
      <View style={{ flex: 1, gap: 2 }}>
        {title && <Text variant="bodyStrong">{title}</Text>}
        <Text variant="small" color="inkSoft">
          {message}
        </Text>
        {action && (
          <Pressable accessibilityRole="button" onPress={action.onPress} style={{ marginTop: space.xs }}>
            <Text variant="bodyStrong" color="primary">
              {action.label}
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

export function Segmented<T extends string>({ options, value, onChange }: { options: { value: T; label: string; count?: number }[]; value: T; onChange: (v: T) => void }) {
  const { colors } = useTheme();
  return (
    <View accessibilityRole="tablist" style={{ flexDirection: 'row', backgroundColor: colors.surfaceSunken, borderRadius: radius.pill, padding: 4 }}>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={o.count !== undefined ? `${o.label}, ${o.count}` : o.label}
            onPress={() => onChange(o.value)}
            style={{ flex: 1, minHeight: 38, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: selected ? colors.surface : 'transparent' }}
          >
            <Text variant="small" color={selected ? 'ink' : 'inkSoft'} style={{ fontFamily: 'Nunito_600SemiBold' }} maxFontSizeMultiplier={1.3} numberOfLines={1}>
              {o.label}
              {o.count ? ` · ${o.count}` : ''}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
