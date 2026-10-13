import { Fraunces_400Regular, Fraunces_400Regular_Italic, Fraunces_600SemiBold } from '@expo-google-fonts/fraunces';
import { Nunito_400Regular, Nunito_600SemiBold, Nunito_700Bold } from '@expo-google-fonts/nunito';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Text } from '@/components/ui/Text';
import { AudioProvider } from '@/lib/audio/AudioProvider';
import { config } from '@/lib/config';
import { refreshPushRegistration } from '@/lib/notifications';
import { useNotificationTaps } from '@/lib/useNotificationTaps';
import { configurePurchases } from '@/lib/purchases';
import { SessionProvider, useSession } from '@/lib/session';
import { ThemeProvider, useTheme } from '@/theme/ThemeProvider';
import { space } from '@/theme/tokens';

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Fraunces_400Regular,
    Fraunces_400Regular_Italic,
    Fraunces_600SemiBold,
    Nunito_400Regular,
    Nunito_600SemiBold,
    Nunito_700Bold,
  });

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <SessionProvider>
            <AudioProvider>
              <Gate fontsLoaded={fontsLoaded} />
            </AudioProvider>
          </SessionProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function Gate({ fontsLoaded }: { fontsLoaded: boolean }) {
  const { ready, session, profile } = useSession();
  const { colors, scheme, reduceMotion } = useTheme();
  const signedIn = !!session;
  const onboarded = !!profile?.onboarded_at;

  useEffect(() => {
    if (fontsLoaded && ready) SplashScreen.hideAsync().catch(() => {});
  }, [fontsLoaded, ready]);

  useEffect(() => {
    if (session && onboarded) {
      refreshPushRegistration();
      configurePurchases(session.user.id).catch(() => {});
    }
  }, [session, onboarded]);

  useNotificationTaps(signedIn && onboarded);

  if (!fontsLoaded || !ready) return null;
  if (!config.isConfigured) return <SetupNeeded />;

  return (
    <>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
          animation: reduceMotion ? 'fade' : 'slide_from_right',
        }}
      >
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
        <Stack.Protected guard={signedIn && !onboarded}>
          <Stack.Screen name="onboarding" />
        </Stack.Protected>
        <Stack.Protected guard={signedIn && onboarded}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="compose" />
          <Stack.Screen name="letter/[id]/index" />
          <Stack.Screen name="letter/[id]/open" options={{ animation: 'fade', gestureEnabled: false }} />
          <Stack.Screen name="notifications" />
          <Stack.Screen name="premium" options={{ presentation: 'modal' }} />
          <Stack.Screen name="report" options={{ presentation: 'modal' }} />
          <Stack.Screen name="account" />
        </Stack.Protected>
        {/* Reachable in every state: invitation links, legal pages, Play's deletion URL. */}
        <Stack.Screen name="claim" />
        <Stack.Screen name="legal" />
        <Stack.Screen name="account-deletion" />
      </Stack>
    </>
  );
}

function SetupNeeded() {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: colors.background, justifyContent: 'center', padding: space.xl, gap: space.md }}>
      <Text variant="title">Almost ready 🌱</Text>
      <Text color="inkSoft">
        This build has no backend configured. Copy .env.example to .env.local and set EXPO_PUBLIC_SUPABASE_URL and
        EXPO_PUBLIC_SUPABASE_ANON_KEY, then restart. See docs/SETUP.md.
      </Text>
    </View>
  );
}
