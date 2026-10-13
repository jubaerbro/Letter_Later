import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * App configuration. Values that differ per environment come from environment variables
 * (see .env.example). Nothing secret belongs here: everything in this file ships in the app.
 *
 * Google Play notes
 *  - ANDROID_PACKAGE is permanent once you upload the first build. Choose it carefully.
 *  - versionCode is managed remotely by EAS (`appVersionSource: remote` in eas.json).
 *  - Permissions are kept to the minimum; anything a library adds that we do not use is
 *    blocked below so the Play Console data-safety form stays simple and honest.
 */
const variant = process.env.APP_VARIANT ?? 'production'; // development | preview | production
const isDev = variant === 'development';

const basePackage = process.env.ANDROID_PACKAGE ?? 'app.letterlater.mobile';
const webUrl = new URL(process.env.EXPO_PUBLIC_WEB_BASE_URL ?? 'https://letterlater.app');

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: isDev ? 'Letter Later (Dev)' : 'Letter Later',
  slug: 'letter-later',
  owner: process.env.EXPO_OWNER,
  version: '1.0.0',
  scheme: isDev ? 'letterlater-dev' : 'letterlater',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  userInterfaceStyle: 'automatic',
  backgroundColor: '#F7F1E6',
  android: {
    package: isDev ? `${basePackage}.dev` : basePackage,
    adaptiveIcon: {
      backgroundColor: '#F3E7D3',
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundImage: './assets/images/android-icon-background.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
    // Push notifications (FCM). Provide the file via an EAS file environment variable.
    googleServicesFile: process.env.GOOGLE_SERVICES_JSON,
    blockedPermissions: [
      'android.permission.RECORD_AUDIO',
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
      'android.permission.READ_MEDIA_AUDIO',
      'android.permission.READ_MEDIA_IMAGES',
      'android.permission.READ_MEDIA_VIDEO',
      'android.permission.SYSTEM_ALERT_WINDOW',
      'android.permission.ACCESS_COARSE_LOCATION',
      'android.permission.ACCESS_FINE_LOCATION',
      'android.permission.CAMERA',
    ],
    // Android App Links: invitation and letter links open the app when installed.
    // Requires https://<host>/.well-known/assetlinks.json (see public/.well-known).
    intentFilters: [
      {
        action: 'VIEW',
        autoVerify: true,
        data: [
          { scheme: 'https', host: webUrl.host, pathPrefix: '/claim' },
          { scheme: 'https', host: webUrl.host, pathPrefix: '/letter' },
        ],
        category: ['BROWSABLE', 'DEFAULT'],
      },
    ],
  },
  ios: {
    bundleIdentifier: isDev ? `${basePackage}.dev` : basePackage,
    supportsTablet: false,
    config: { usesNonExemptEncryption: false },
  },
  web: {
    output: 'single',
    favicon: './assets/images/favicon.png',
    name: 'Letter Later',
    themeColor: '#5B7A52',
    backgroundColor: '#F7F1E6',
  },
  plugins: [
    'expo-router',
    [
      'expo-splash-screen',
      {
        backgroundColor: '#F7F1E6',
        image: './assets/images/splash-icon.png',
        imageWidth: 120,
        dark: { backgroundColor: '#141A16', image: './assets/images/splash-icon.png' },
      },
    ],
    // Playback only. No microphone, so no RECORD_AUDIO permission is requested.
    ['expo-audio', { microphonePermission: false, recordAudioAndroid: false, enableBackgroundPlayback: true }],
    'expo-localization',
    '@react-native-community/datetimepicker',
    [
      'expo-notifications',
      { icon: './assets/images/notification-icon.png', color: '#5B7A52', defaultChannel: 'letters' },
    ],
    [
      'expo-build-properties',
      { android: { enableMinifyInReleaseBuilds: true, enableShrinkResourcesInReleaseBuilds: true } },
    ],
  ],
  extra: {
    appVariant: variant,
    eas: process.env.EAS_PROJECT_ID ? { projectId: process.env.EAS_PROJECT_ID } : undefined,
  },
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
});
