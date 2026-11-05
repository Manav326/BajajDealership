import type { ExpoConfig } from 'expo/config';
import { withAndroidManifest } from 'expo/config-plugins';

const appVersion = (process.env.BAJAJ_APP_VERSION || '0.2.0').trim();
const versionCode = Number(process.env.BAJAJ_ANDROID_VERSION_CODE || '2');
if (!/^\d+\.\d+\.\d+$/.test(appVersion)) throw new Error('BAJAJ_APP_VERSION must be a stable semantic version.');
if (!Number.isSafeInteger(versionCode) || versionCode < 1 || versionCode > 2100000000) throw new Error('BAJAJ_ANDROID_VERSION_CODE must be a positive Android version code.');

const apiBaseUrl = (process.env.EXPO_PUBLIC_API_BASE_URL || 'https://api-luckybajaj.quantaedge.in/').trim();
const customerWebUrl = (process.env.EXPO_PUBLIC_CUSTOMER_WEB_URL || 'https://luckybajaj.quantaedge.in').trim().replace(/\/+$/, '');

const baseConfig: ExpoConfig = {
  name: 'Lucky Bajaj',
  slug: 'lucky-bajaj-customer',
  scheme: 'luckybajaj',
  version: appVersion,
  orientation: 'default',
  userInterfaceStyle: 'light',
  plugins: [
    '@react-native-community/datetimepicker',
    'expo-image-picker',
    'expo-secure-store',
  ],
  android: {
    package: 'com.quantaedge.luckybajaj',
    versionCode,
  },
  extra: { apiBaseUrl, customerWebUrl, appVersion, androidPackage: 'com.quantaedge.luckybajaj' },
};

// Permit cleartext HTTP only when an explicit local development URL is supplied.
const withConfiguredCleartext = withAndroidManifest(baseConfig, (config) => {
  const application = config.modResults.manifest.application?.[0];
  if (application) {
    if (apiBaseUrl.startsWith('http://')) {
      application.$['android:usesCleartextTraffic'] = 'true';
    } else {
      delete application.$['android:usesCleartextTraffic'];
    }
  }
  return config;
});

export default withConfiguredCleartext;
