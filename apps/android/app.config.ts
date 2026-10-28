import type { ExpoConfig } from 'expo/config';
import { withAndroidManifest } from 'expo/config-plugins';

const apiBaseUrl = (process.env.EXPO_PUBLIC_API_BASE_URL || 'https://lucky-bajaj-api.onrender.com/').trim();

const baseConfig: ExpoConfig = {
  name: 'Lucky Bajaj',
  slug: 'lucky-bajaj-customer',
  scheme: 'luckybajaj',
  version: '0.1.0',
  orientation: 'portrait',
  userInterfaceStyle: 'light',
  plugins: ['@react-native-community/datetimepicker'],
  android: {
    package: 'com.quantaedge.luckybajaj',
    versionCode: 1,
  },
  extra: {
    apiBaseUrl,
  },
};

// Permit cleartext only for a configured local-development URL; production must use HTTPS.
// Default builds use the deployed Bajaj API. Override with the mPAY-style LAN URL only for local-device testing.
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
