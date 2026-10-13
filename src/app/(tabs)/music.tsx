import { Alert, Platform, Pressable, View } from 'react-native';
import { Slider } from '@/components/music/Slider';
import { IconButton } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Card, Screen, Section, ToggleRow } from '@/components/ui/Layout';
import { Text } from '@/components/ui/Text';
import { useAudio } from '@/lib/audio/AudioProvider';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export default function Music() {
  const { colors } = useTheme();
  const a = useAudio();
  const current = a.current ?? a.tracks[0];

  return (
    <Screen>
      <Text variant="title">Garden sounds</Text>
      <Text color="inkSoft" style={{ marginTop: space.xs }}>
        Quiet music for writing letters or sitting with your trees.
      </Text>

      <Card style={{ marginTop: space.xl, gap: space.md, alignItems: 'center' }}>
        <View style={{ width: 96, height: 96, borderRadius: 48, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="music" size={40} color={colors.primary} />
        </View>
        <Text variant="heading" center>
          {current?.title ?? 'Choose a sound'}
        </Text>
        <Text variant="small" color="inkSoft" center>
          {current?.mood}
        </Text>
        <View style={{ alignSelf: 'stretch' }}>
          <Slider label="Playback position" value={a.position} max={Math.max(1, a.duration)} onChange={a.seek} step={10} format={mmss} />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text variant="caption" color="muted">
              {mmss(a.position)}
            </Text>
            <Text variant="caption" color="muted">
              {mmss(a.duration)}
            </Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.lg }}>
          <IconButton icon="prev" label="Previous track" onPress={a.previous} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={a.playing ? 'Pause' : 'Play'}
            onPress={() => (a.playing ? a.pause() : a.play(current))}
            style={({ pressed }) => ({ width: 68, height: 68, borderRadius: 34, backgroundColor: pressed ? colors.primaryPressed : colors.primary, alignItems: 'center', justifyContent: 'center' })}
          >
            <Icon name={a.playing ? 'pause' : 'play'} size={28} color={colors.onPrimary} strokeWidth={2.4} />
          </Pressable>
          <IconButton icon="next" label="Next track" onPress={a.next} />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, alignSelf: 'stretch' }}>
          <Icon name="volume" size={20} color={colors.inkSoft} />
          <View style={{ flex: 1 }}>
            <Slider label="Volume" value={a.volume} onChange={a.setVolume} />
          </View>
        </View>
      </Card>

      <Section title="Sounds">
        <View style={{ gap: space.sm }}>
          {a.tracks.map((t) => {
            const active = a.current?.id === t.id;
            return (
              <Pressable
                key={t.id}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`${t.title}. ${t.mood}`}
                onPress={() => a.play(t)}
                onLongPress={
                  t.builtIn
                    ? undefined
                    : () =>
                        Alert.alert('Remove this sound?', 'The file is removed from LaterLetter on this device.', [
                          { text: 'Keep', style: 'cancel' },
                          { text: 'Remove', style: 'destructive', onPress: () => a.removeOwnTrack(t.id) },
                        ])
                }
                style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.md, backgroundColor: active ? colors.primarySoft : colors.surface, borderWidth: 1, borderColor: active ? colors.primary : colors.border }}
              >
                <Icon name={t.builtIn ? 'music' : 'file'} color={active ? colors.primary : colors.inkSoft} />
                <View style={{ flex: 1 }}>
                  <Text variant="bodyStrong">{t.title}</Text>
                  <Text variant="small" color="inkSoft">
                    {t.mood}
                  </Text>
                </View>
                {active && a.playing && <Icon name="volume" size={18} color={colors.primary} />}
              </Pressable>
            );
          })}
          {Platform.OS !== 'web' && (
            <Pressable accessibilityRole="button" onPress={() => a.addOwnFile().catch(() => Alert.alert('Couldn’t add that file', 'Please choose an audio file you own.'))} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md }}>
              <Icon name="plus" color={colors.primary} />
              <Text variant="bodyStrong" color="primary">
                Add music from your device
              </Text>
            </Pressable>
          )}
          <Text variant="small" color="muted">
            Built-in sounds are original to LaterLetter. Files you add stay on this device — please only add music you have the right to use.
          </Text>
        </View>
      </Section>

      <Section title="Preferences">
        <ToggleRow label="Keep playing in the background" detail="Shows simple controls on your lock screen." value={a.background} onChange={a.setBackground} />
        <ToggleRow label="Little sound effects" detail="Water drops, sunlight chimes and the seal." value={a.soundEffects} onChange={a.setSoundEffects} />
      </Section>
    </Screen>
  );
}
