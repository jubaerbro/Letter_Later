import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import { useAudio } from '@/lib/audio/AudioProvider';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';
import { IconButton } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { Text } from '../ui/Text';

/** A slim bar shown while music is chosen, so it never feels hidden or stuck. */
export function MiniPlayer() {
  const { colors } = useTheme();
  const audio = useAudio();
  if (!audio.current) return null;
  return (
    <View style={{ marginHorizontal: space.lg, flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingLeft: space.md, paddingVertical: 2, borderRadius: radius.lg, backgroundColor: colors.primarySoft }}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Now playing ${audio.current.title}. Open music`} onPress={() => router.navigate('/music')} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <Icon name="music" size={18} color={colors.primary} />
        <Text variant="small" numberOfLines={1} style={{ flex: 1 }}>
          {audio.current.title}
        </Text>
      </Pressable>
      <IconButton icon={audio.playing ? 'pause' : 'play'} label={audio.playing ? 'Pause music' : 'Play music'} onPress={audio.toggle} size={40} tint={colors.primary} />
    </View>
  );
}
