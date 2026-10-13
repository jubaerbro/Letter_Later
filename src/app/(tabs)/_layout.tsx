import { Tabs } from 'expo-router';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MiniPlayer } from '@/components/music/MiniPlayer';
import { Icon, type IconName } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';

const TABS: { name: string; label: string; icon: IconName }[] = [
  { name: 'index', label: 'Garden', icon: 'garden' },
  { name: 'mailbox', label: 'Mailbox', icon: 'mailbox' },
  { name: 'music', label: 'Music', icon: 'music' },
  { name: 'settings', label: 'You', icon: 'user' },
];

export default function TabsLayout() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Tabs
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.background } }}
      tabBar={({ state, navigation }) => (
        <View style={{ backgroundColor: colors.background }}>
          {state.routes[state.index]?.name !== 'music' && <MiniPlayer />}
          <View
            accessibilityRole="tablist"
            style={{
              flexDirection: 'row',
              marginHorizontal: space.lg,
              marginBottom: Math.max(insets.bottom, space.sm),
              marginTop: space.xs,
              padding: space.xs,
              borderRadius: radius.xl,
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.border,
              shadowColor: colors.shadow,
              shadowOpacity: 1,
              shadowRadius: 16,
              shadowOffset: { width: 0, height: 4 },
              elevation: 4,
            }}
          >
            {state.routes.map((route, i) => {
              const tab = TABS.find((t) => t.name === route.name);
              if (!tab) return null;
              const focused = state.index === i;
              return (
                <Pressable
                  key={route.key}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: focused }}
                  accessibilityLabel={tab.label}
                  onPress={() => {
                    const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
                    if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
                  }}
                  style={{ flex: 1, alignItems: 'center', paddingVertical: space.sm, borderRadius: radius.lg, backgroundColor: focused ? colors.primarySoft : 'transparent', gap: 2 }}
                >
                  <Icon name={tab.icon} color={focused ? colors.primary : colors.inkSoft} />
                  <Text variant="caption" color={focused ? 'primary' : 'inkSoft'} maxFontSizeMultiplier={1.2}>
                    {tab.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      )}
    >
      {TABS.map((t) => (
        <Tabs.Screen key={t.name} name={t.name} options={{ title: t.label }} />
      ))}
    </Tabs>
  );
}
