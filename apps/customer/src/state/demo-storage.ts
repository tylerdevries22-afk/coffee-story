import type { PortalBundle } from '@platform/domain';
import { portalStore } from '@platform/expo-storage';
import {
  createDemoPortalStore,
  parseStoredAppMode,
  parseStoredPortal as parseStoredPortalWith,
} from '@platform/offline';

import { createInitialDemoPortal, migrateDemoPortalState } from '@/state/demo-state';

import { APP_MODE_STORAGE_KEY, LEGACY_PORTAL_STORAGE_KEY } from './demo-storage-keys';

/**
 * This app's demo persistence, wired from the two shared halves.
 *
 * `demo-storage.ts` was 321 byte-identical lines in both Expo apps, and so were
 * both `portal-store` variants beside it. The parsers and the load/save
 * orchestration are pure, so they moved to `@platform/offline`; the file and
 * secure-store handles are native, so they moved to `@platform/expo-storage`.
 * What is genuinely per-app is only what is injected here: this app's preview
 * seed and its own namespaced SecureStore keys.
 */
const demoPortal = createDemoPortalStore(
  portalStore({ appModeKey: APP_MODE_STORAGE_KEY, legacyPortalKey: LEGACY_PORTAL_STORAGE_KEY }),
  { createInitial: createInitialDemoPortal, migrate: migrateDemoPortalState },
);

export { parseStoredAppMode };

/** Bound to this app's own migration; the validation behind it is shared. */
export function parseStoredPortal(raw: string | null): PortalBundle | null {
  return parseStoredPortalWith(raw, migrateDemoPortalState);
}

export const {
  loadStoredAppMode,
  saveStoredAppMode,
  loadStoredPortal,
  saveStoredPortal,
  resetStoredDemoPortal,
} = demoPortal;
