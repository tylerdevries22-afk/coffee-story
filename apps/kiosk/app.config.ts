import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ConfigContext, ExpoConfig } from 'expo/config';

type KioskBrand = {
  identity: {
    slug: string;
    name: string;
    kioskBundleId: string;
    kioskScheme: string;
  };
  tokens?: { primary?: string; surface?: string };
};

const brand = JSON.parse(
  readFileSync(join(__dirname, 'src', 'tenant', 'brand.json'), 'utf8'),
) as KioskBrand;

/** The checked-in tenant copy is refreshed by `pnpm onboard --tenant <slug> --apply`. */
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: `${brand.identity.name} Kiosk`,
  slug: `${brand.identity.slug}-kiosk`,
  version: '1.0.0',
  orientation: 'landscape',
  icon: './assets/images/icon.png',
  scheme: brand.identity.kioskScheme,
  runtimeVersion: 'exposdk:54.0.0',
  updates: { url: 'https://u.expo.dev/965cd044-8020-41d0-b719-337f6c9f6f72' },
  userInterfaceStyle: 'light',
  ios: {
    bundleIdentifier: brand.identity.kioskBundleId,
    supportsTablet: true,
    requireFullScreen: true,
    config: { usesNonExemptEncryption: false },
  },
  android: {
    package: brand.identity.kioskBundleId,
    adaptiveIcon: {
      backgroundColor: brand.tokens?.primary ?? '#1C1917',
      foregroundImage: './assets/images/android-icon-foreground.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
  },
  web: { output: 'static', favicon: './assets/images/favicon.png' },
  plugins: [
    'expo-router',
    [
      'expo-splash-screen',
      {
        backgroundColor: brand.tokens?.surface ?? '#FFFFFF',
        image: './assets/brand/logo.png',
        imageWidth: 180,
      },
    ],
  ],
  experiments: { typedRoutes: true },
  extra: {
    router: {},
    eas: { projectId: '965cd044-8020-41d0-b719-337f6c9f6f72' },
  },
  owner: 'tylerdevries222',
});
