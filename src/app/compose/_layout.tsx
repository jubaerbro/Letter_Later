import { Stack } from 'expo-router';
import { ComposeProvider } from '@/lib/compose';
import { deviceTimeZone } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useTheme } from '@/theme/ThemeProvider';

export default function ComposeLayout() {
  const { colors, reduceMotion } = useTheme();
  const { profile } = useSession();
  return (
    <ComposeProvider timeZone={profile?.time_zone ?? deviceTimeZone()}>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background }, animation: reduceMotion ? 'fade' : 'slide_from_right' }}>
        <Stack.Screen name="planted" options={{ gestureEnabled: false, animation: 'fade' }} />
      </Stack>
    </ComposeProvider>
  );
}
