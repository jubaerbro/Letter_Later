import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { setTreeStyle, treeStyles } from '@/lib/api';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';
import { Icon } from '../ui/Icon';
import { Text } from '../ui/Text';
import { styleInfo } from './palette';
import { Tree } from './Tree';

export function StylePicker({ treeId, current, onChange }: { treeId: string; current: string; onChange: (style: string) => void }) {
  const { colors } = useTheme();
  const [styles, setStyles] = useState<{ style: string; unlocked: boolean; requirement: string }[]>([]);

  useEffect(() => {
    treeStyles().then(setStyles).catch(() => {});
  }, []);

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm, paddingVertical: space.xs }}>
      {styles.map((s) => {
        const selected = s.style === current;
        const info = styleInfo(s.style);
        return (
          <Pressable
            key={s.style}
            accessibilityRole="button"
            accessibilityState={{ selected, disabled: !s.unlocked }}
            accessibilityLabel={`${info.label} tree. ${s.unlocked ? (selected ? 'Selected' : 'Choose') : `Locked: ${s.requirement}`}`}
            onPress={async () => {
              if (!s.unlocked) {
                if (info.premium) router.push('/premium');
                return;
              }
              await setTreeStyle(treeId, s.style).catch(() => {});
              onChange(s.style);
            }}
            style={{ width: 96, alignItems: 'center', padding: space.sm, borderRadius: radius.md, borderWidth: 2, borderColor: selected ? colors.primary : colors.border, backgroundColor: colors.surface, opacity: s.unlocked ? 1 : 0.6 }}
          >
            <Tree stage="young" growth={0.7} style={s.style} size={64} sway={false} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
              {!s.unlocked && <Icon name={info.premium ? 'sparkle' : 'lock'} size={12} color={colors.muted} />}
              <Text variant="caption">{info.label}</Text>
            </View>
            {!s.unlocked && (
              <Text variant="caption" color="muted" center numberOfLines={2} style={{ fontSize: 10, lineHeight: 12 }}>
                {s.requirement}
              </Text>
            )}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
