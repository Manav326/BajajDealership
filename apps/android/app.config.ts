import type { ExpoConfig } from 'expo/config';
import { withAndroidManifest } from 'expo/config-plugins';

const apiBaseUrl = (process.env.EXPO_PUBLIC_API_BASE_URL || '').trim();

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

// HTTP is allowed only for a build explicitly configured with a development URL.
// Production builds should set EXPO_PUBLIC_API_BASE_URL to an HTTPS endpoint.
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
