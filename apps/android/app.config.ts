import type { ExpoConfig } from 'expo/config';

const apiBaseUrl = (process.env.EXPO_PUBLIC_API_BASE_URL || '').trim();

const config: ExpoConfig = {
  name: 'Lucky Bajaj',
  slug: 'lucky-bajaj-customer',
  scheme: 'luckybajaj',
  version: '0.1.0',
  orientation: 'portrait',
  userInterfaceStyle: 'light',
  newArchEnabled: true,
  plugins: ['@react-native-community/datetimepicker'],
  android: {
    package: 'com.quantaedge.luckybajaj',
    versionCode: 1,
    // Plain HTTP is permitted only for explicitly configured development endpoints.
    usesCleartextTraffic: apiBaseUrl.startsWith('http://'),
  },
  extra: {
    apiBaseUrl,
  },
};

export default config;
