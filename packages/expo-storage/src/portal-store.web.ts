import type { PortalTextStore } from '@platform/offline';

import { DEMO_PORTAL_FILE_NAME, type PortalStoreKeys } from './portal-store-keys';

/**
 * Web persistence for the demo portal.
 *
 * expo-file-system and expo-secure-store have no web implementation, so the
 * browser demo keeps its state in localStorage instead. There is no write-then-
 * rename dance to mirror: localStorage.setItem is atomic from the page's point
 * of view, so a torn write is not a failure mode here.
 *
 * Every access is guarded -- Safari private browsing throws on localStorage, and
 * losing demo persistence should degrade to "starts fresh", never a crash.
 */
function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function read(key: string): string | null {
  try {
    return storage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    storage()?.setItem(key, value);
  } catch {
    // Quota or private-browsing refusal: the demo simply will not persist.
  }
}

export function portalStore(keys: PortalStoreKeys): PortalTextStore {
  return Object.freeze({
    readAppMode: async () => read(keys.appModeKey),
    writeAppMode: async (mode: string) => write(keys.appModeKey, mode),
    readPortalText: async () => read(DEMO_PORTAL_FILE_NAME),
    writePortalText: async (json: string) => write(DEMO_PORTAL_FILE_NAME, json),
    /** No SecureStore ever existed on web, so there is nothing to migrate. */
    readLegacyPortalText: async () => null,
    clearLegacyPortal: async () => {
      // Nothing to clear.
    },
  });
}
