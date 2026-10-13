import { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { isValidTimeZone, timeZoneLabel } from '@shared/domain/time.ts';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';
import { IconButton } from './ui/Button';
import { Icon } from './ui/Icon';
import { Text } from './ui/Text';
import { TextField } from './ui/TextField';

const COMMON = [
  'UTC', 'Europe/London', 'Europe/Dublin', 'Europe/Lisbon', 'Europe/Paris', 'Europe/Berlin', 'Europe/Madrid', 'Europe/Rome', 'Europe/Amsterdam',
  'Europe/Stockholm', 'Europe/Warsaw', 'Europe/Athens', 'Europe/Istanbul', 'Europe/Kyiv', 'Europe/Moscow', 'Africa/Cairo', 'Africa/Lagos',
  'Africa/Nairobi', 'Africa/Johannesburg', 'Asia/Dubai', 'Asia/Tehran', 'Asia/Karachi', 'Asia/Kolkata', 'Asia/Kathmandu', 'Asia/Dhaka',
  'Asia/Yangon', 'Asia/Bangkok', 'Asia/Jakarta', 'Asia/Singapore', 'Asia/Kuala_Lumpur', 'Asia/Manila', 'Asia/Hong_Kong', 'Asia/Shanghai',
  'Asia/Taipei', 'Asia/Seoul', 'Asia/Tokyo', 'Australia/Perth', 'Australia/Adelaide', 'Australia/Brisbane', 'Australia/Sydney',
  'Australia/Melbourne', 'Pacific/Auckland', 'Pacific/Honolulu', 'America/Anchorage', 'America/Los_Angeles', 'America/Vancouver',
  'America/Denver', 'America/Phoenix', 'America/Chicago', 'America/Mexico_City', 'America/New_York', 'America/Toronto', 'America/Bogota',
  'America/Lima', 'America/Caracas', 'America/Halifax', 'America/Santiago', 'America/Sao_Paulo', 'America/Argentina/Buenos_Aires',
  'America/St_Johns', 'Atlantic/Reykjavik',
];

export function TimeZonePicker({ value, onChange }: { value: string; onChange: (tz: string) => void }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const zones = useMemo(() => {
    const all = Array.from(new Set([value, ...COMMON])).filter(isValidTimeZone);
    const q = query.trim().toLowerCase().replace(/\s+/g, '_');
    return q ? all.filter((z) => z.toLowerCase().includes(q)) : all;
  }, [value, query]);
  const now = new Date();

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Time zone: ${value}. Change`}
        onPress={() => setOpen(true)}
        style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }}
      >
        <Icon name="clock" color={colors.inkSoft} />
        <View style={{ flex: 1 }}>
          <Text variant="caption" color="inkSoft">
            TIME ZONE
          </Text>
          <Text variant="bodyStrong">
            {value.replace(/_/g, ' ')} · {timeZoneLabel(value, now)}
          </Text>
        </View>
        <Text variant="small" color="primary">
          Change
        </Text>
      </Pressable>
      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top + space.md, paddingHorizontal: space.xl }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text variant="title">Time zone</Text>
            <IconButton icon="close" label="Close" onPress={() => setOpen(false)} />
          </View>
          <TextField label="Search" value={query} onChangeText={setQuery} autoCapitalize="none" placeholder="e.g. London, Tokyo, New York" />
          <FlatList
            data={zones}
            keyExtractor={(z) => z}
            contentContainerStyle={{ paddingBottom: insets.bottom + space.xl }}
            renderItem={({ item }) => (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: item === value }}
                onPress={() => {
                  onChange(item);
                  setOpen(false);
                }}
                style={{ paddingVertical: space.md, flexDirection: 'row', justifyContent: 'space-between' }}
              >
                <Text variant="body">{item.replace(/_/g, ' ')}</Text>
                <Text variant="small" color={item === value ? 'primary' : 'muted'}>
                  {timeZoneLabel(item, now)}
                </Text>
              </Pressable>
            )}
          />
        </View>
      </Modal>
    </>
  );
}
