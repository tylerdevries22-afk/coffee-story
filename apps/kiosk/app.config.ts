import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ConfigContext, ExpoConfig } from 'expo/config';

type KioskBrand = {
  identity: {
    slug: string;
    name: string;
    kioskBundleId: string;
    kioskScheme: string;
    kioskEasProjectId: string;
  };
  tokens?: { primary?: string; surface?: string };
};

type KioskEasConfig = {
  extra: { router: Record<string, never>; eas?: { projectId: string } };
  updates?: { url: string };
};

/** An empty project id is valid until this tenant's kiosk runs `eas init`. */
export function kioskEasConfig(projectId: string | undefined): KioskEasConfig {
  const normalized = projectId?.trim() ?? '';
  return {
    extra: {
      router: {},
      ...(normalized ? { eas: { projectId: normalized } } : {}),
    },
    ...(normalized ? { updates: { url: `https://u.expo.dev/${normalized}` } } : {}),
  };
}

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
  userInterfaceStyle: 'light',
  ios: {
    icon: './assets/expo.icon',
    bundleIdentifier: brand.identity.kioskBundleId,
    supportsTablet: true,
    requireFullScreen: true,
    config: { usesNonExemptEncryption: false },
    infoPlist: {
      NSFaceIDUsageDescription: "Protect this kiosk's non-exportable device identity.",
    },
  },
  android: {
    package: brand.identity.kioskBundleId,
    adaptiveIcon: {
      backgroundColor: brand.tokens?.primary ?? '#1C1917',
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundImage: './assets/images/android-icon-background.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
    permissions: [
      'android.permission.FOREGROUND_SERVICE',
      'android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION',
    ],
    blockedPermissions: [
      'android.permission.CAMERA',
      'android.permission.RECORD_AUDIO',
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
      'android.permission.READ_MEDIA_AUDIO',
      'android.permission.READ_MEDIA_IMAGES',
      'android.permission.READ_MEDIA_VIDEO',
    ],
  },
  web: { output: 'static', favicon: './assets/images/favicon.png' },
  plugins: [
    'expo-router',
    '../../packages/device-twin/with-media-projection.cjs',
    'expo-secure-store',
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
  ...kioskEasConfig(brand.identity.kioskEasProjectId),
  owner: 'tylerdevries222',
});
