import { APP_MODE_STORAGE_KEY, DEMO_PORTAL_FILE_NAME } from './demo-storage-keys';

/**
 * Web persistence for the demo portal.
 *
 * expo-file-system and expo-secure-store have no web implementation, so the
 * browser demo keeps its state in localStorage instead. There is no write-then-
 * rename dance to mirror: localStorage.setItem is atomic from the page's point
 * of view, so a torn write is not a failure mode here.
 *
 * Every access is guarded — Safari private browsing throws on localStorage, and
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

export async function readAppMode(): Promise<string | null> {
  return read(APP_MODE_STORAGE_KEY);
}

export async function writeAppMode(mode: string): Promise<void> {
  write(APP_MODE_STORAGE_KEY, mode);
}

export async function readPortalText(): Promise<string | null> {
  return read(DEMO_PORTAL_FILE_NAME);
}

export async function writePortalText(json: string): Promise<void> {
  write(DEMO_PORTAL_FILE_NAME, json);
}

/** No SecureStore ever existed on web, so there is nothing to migrate. */
export async function readLegacyPortalText(): Promise<string | null> {
  return null;
}

export async function clearLegacyPortal(): Promise<void> {
  // Nothing to clear.
}
