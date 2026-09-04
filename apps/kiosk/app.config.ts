/**
 * Expo config for the kiosk binary (rule 7: one kiosk binary per brand).
 *
 * This file had no tenant override at all: it read whichever brand file the
 * last `pnpm onboard --apply` had written, so a second franchisee's kiosk could
 * not be built from the same checkout. It now resolves an applied tenant the
 * same way the customer config and the bundle itself do.
 */
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

/**
 * Which applied tenant this build is for, by the same rule the app uses at runtime.
 *
 * `src/tenants/` holds one directory per applied tenant and `applied.json`
 * names them; `src/tenants/index.ts` selects one from `EXPO_PUBLIC_TENANT` when
 * the bundle boots. This has to agree with that or the build is the exact
 * failure the slot layout exists to prevent -- one shop's identity over another
 * shop's menu, correctly signed, with nothing in the log to say so. Duplicated
 * here rather than imported because Expo's config loader transpiles this file
 * and not workspace TypeScript it imports; `src/tenant/tenant.test.ts` pins the
 * two answers together.
 *
 * `TENANT` stays accepted as the legacy build-time name, but only when it
 * agrees with `EXPO_PUBLIC_TENANT`: `TENANT` alone cannot reach the bundle, so
 * honouring it by itself is how a franchisee got a correctly named binary
 * carrying somebody else's menu.
 */
function resolveAppliedTenant(appDirectory: string, app: string): string {
  const manifest: { slugs?: string[] } = JSON.parse(
    readFileSync(join(appDirectory, 'src', 'tenants', 'applied.json'), 'utf8'),
  );
  // Shape-checked, not just membership-checked: these entries are joined into
  // a filesystem path below, and a hand-edited `..` would read out of the slot
  // directory entirely. Kebab-case cannot contain a dot or a slash.
  const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  const applied = [...(manifest.slugs ?? [])].filter((slug) => slugPattern.test(slug)).sort();
  const runtime = process.env.EXPO_PUBLIC_TENANT?.trim() ?? '';
  const legacy = process.env.TENANT?.trim() ?? '';
  if (legacy !== '' && legacy !== runtime) {
    throw new Error(
      `TENANT="${legacy}" cannot reach the bundle; only EXPO_PUBLIC_TENANT is inlined. `
      + `Build with EXPO_PUBLIC_TENANT=${legacy} instead.`,
    );
  }
  if (applied.length === 0) {
    throw new Error(`apps/${app} has no tenant applied. Run \`pnpm onboard --tenant <slug> --apply\`.`);
  }
  if (runtime !== '') {
    if (!slugPattern.test(runtime) || !applied.includes(runtime)) {
      throw new Error(
        `EXPO_PUBLIC_TENANT="${runtime}" is not applied to apps/${app}. Applied: ${applied.join(', ')}. `
        + `Run \`pnpm onboard --tenant ${runtime} --apply\` first.`,
      );
    }
    return runtime;
  }
  const only = applied[0];
  if (applied.length === 1 && only !== undefined) return only;
  throw new Error(
    `apps/${app} bundles ${applied.length} tenants (${applied.join(', ')}) and EXPO_PUBLIC_TENANT is not set. `
    + 'Set EXPO_PUBLIC_TENANT=<slug> so this build picks one.',
  );
}

/** Read from the applied copy, so the identity always matches the bundled menu. */
export function appliedBrandPath(appDirectory: string, app: string): string {
  return join(appDirectory, 'src', 'tenants', resolveAppliedTenant(appDirectory, app), 'brand.json');
}

const brand = JSON.parse(readFileSync(appliedBrandPath(__dirname, 'kiosk'), 'utf8')) as KioskBrand;

/** One applied tenant per build, chosen by `EXPO_PUBLIC_TENANT`. */
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
