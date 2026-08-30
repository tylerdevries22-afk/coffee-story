/**
 * Expo config, tenant-driven (rule 7: one customer binary per brand).
 *
 * `TENANT` (env) picks the tenant folder at build/publish time; identity --
 * display name, slug, scheme, bundle/package id, EAS project -- comes from
 * `tenants/<slug>/brand.json`. Icons and splash keep pointing into ./assets;
 * `pnpm onboard --tenant <slug>` regenerates those files from the tenant's
 * own artwork, so the paths stay stable while the pixels change per brand.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * The tenant to build, defaulting to the one already applied here.
 *
 * `src/tenant/brand.json` is what `pnpm onboard --tenant <slug> --apply` writes
 * and what apps/kiosk reads outright, so it is the honest answer to "which
 * brand is this checkout configured for". Naming the first tenant instead meant
 * a franchisee who forgot `TENANT=` shipped somebody else's binary -- correctly
 * signed, correctly named, wrong shop.
 */
const applied: { identity?: { slug?: string } } = JSON.parse(
  readFileSync(join(__dirname, 'src', 'tenant', 'brand.json'), 'utf8'),
);
const slug = process.env.TENANT ?? applied.identity?.slug;
if (!slug) throw new Error('No tenant: set TENANT, or apply one with `pnpm onboard --tenant <slug> --apply`.');

type BrandFile = {
  identity: { slug: string; name: string; bundleId: string; scheme: string; easProjectId: string };
  tokens?: { primary?: string; surface?: string };
};

const brand: BrandFile = JSON.parse(
  readFileSync(join(__dirname, '../../tenants', slug, 'brand.json'), 'utf8'),
);

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: brand.identity.name,
  slug: brand.identity.slug,
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  scheme: brand.identity.scheme,
  runtimeVersion: 'exposdk:54.0.0',
  userInterfaceStyle: 'light',
  ios: {
    icon: './assets/expo.icon',
    bundleIdentifier: brand.identity.bundleId,
    supportsTablet: false,
    usesAppleSignIn: false,
    infoPlist: {
      NSMotionUsageDescription: `${brand.identity.name} uses device motion so the drink in your rewards cup responds to how you hold your phone.`,
    },
    config: {
      usesNonExemptEncryption: false,
    },
  },
  android: {
    adaptiveIcon: {
      backgroundColor: brand.tokens?.primary ?? '#241710',
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundImage: './assets/images/android-icon-background.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
    permissions: ['android.permission.READ_CALENDAR', 'android.permission.WRITE_CALENDAR'],
    package: brand.identity.bundleId,
  },
  web: {
    output: 'static',
    favicon: './assets/images/favicon.png',
  },
  plugins: [
    'expo-router',
    [
      'expo-splash-screen',
      {
        backgroundColor: brand.tokens?.surface ?? '#FAF5EF',
        image: './assets/brand/logo.png',
        imageWidth: 180,
      },
    ],
    'expo-secure-store',
    [
      'expo-image-picker',
      {
        photosPermission: `Allow ${brand.identity.name} to choose a profile photo for your account.`,
        cameraPermission: false,
        microphonePermission: false,
      },
    ],
    [
      'expo-calendar',
      {
        calendarPermission: `Allow ${brand.identity.name} to add your pickup time to your calendar.`,
        remindersPermission: false,
      },
    ],
    'expo-video',
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  extra: {
    router: {},
    ...(brand.identity.easProjectId
      ? { eas: { projectId: brand.identity.easProjectId } }
      : {}),
  },
  owner: 'tylerdevries222',
  ...(brand.identity.easProjectId
    ? { updates: { url: `https://u.expo.dev/${brand.identity.easProjectId}` } }
    : {}),
});
