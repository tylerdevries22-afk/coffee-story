import {
  APP_MODE_STORAGE_KEY,
  DEMO_PORTAL_FILE_NAME,
  DEMO_PORTAL_TEMP_FILE_NAME,
  LEGACY_PORTAL_STORAGE_KEY,
} from './demo-storage-keys';

/**
 * Native persistence for the demo portal.
 *
 * Split out from `demo-storage.ts` so the web build can substitute
 * `portal-store.web.ts`: expo-file-system and expo-secure-store have no web
 * implementation, and the browser demo would otherwise start from scratch on
 * every reload.
 *
 * Native modules stay behind dynamic `await import()` so `node:test` never
 * evaluates them when it exercises the pure parsers.
 */

async function portalFiles() {
  const { File, Paths } = await import('expo-file-system');
  return {
    target: new File(Paths.document, DEMO_PORTAL_FILE_NAME),
    temp: new File(Paths.document, DEMO_PORTAL_TEMP_FILE_NAME),
  };
}

export async function readAppMode(): Promise<string | null> {
  const SecureStore = await import('expo-secure-store');
  return SecureStore.getItemAsync(APP_MODE_STORAGE_KEY);
}

export async function writeAppMode(mode: string): Promise<void> {
  const SecureStore = await import('expo-secure-store');
  await SecureStore.setItemAsync(APP_MODE_STORAGE_KEY, mode);
}

export async function readPortalText(): Promise<string | null> {
  const { target, temp } = await portalFiles();
  if (target.exists) {
    try {
      return await target.text();
    } catch {
      // fall through to the staging file below
    }
  }
  // A save that died between "data durable" and "rename" leaves a complete temp
  // file and a missing/unusable target. Recovering it turns what would have been
  // total loss of the user's demo state into a no-op.
  if (temp.exists) {
    try {
      return await temp.text();
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * expo-file-system renamed its synchronous relocation between SDK versions:
 * SDK 57 exposes `moveSync(destination, { overwrite })`, while the SDK 54 build
 * the Expo Go demo runs offers only `move(destination)`, which refuses an
 * existing target. Probing for the newer method keeps one implementation valid
 * in both apps.
 */
type AtomicMove = { moveSync(destination: unknown, options: { overwrite: boolean }): void };

export async function writePortalText(json: string): Promise<void> {
  const { target, temp } = await portalFiles();
  // Write-then-rename. Deleting the live portal before the replacement is
  // durable turns any mid-write failure (disk pressure, protected-data class,
  // process death) into permanent loss of every demo mutation; a rename over a
  // fully written staging file cannot leave a truncated or empty target.
  if (temp.exists) temp.delete();
  temp.create({ intermediates: true });
  temp.write(json);
  // Looked up rather than type-guarded: a `file is File & AtomicMove` predicate
  // narrows the negative branch to `never` under SDK 57, where File already
  // declares moveSync.
  const moveSync = (temp as Partial<AtomicMove>).moveSync;
  if (typeof moveSync === 'function') {
    moveSync.call(temp, target, { overwrite: true });
    return;
  }
  // Without an overwriting rename the target has to go first. The staging file
  // is already fully written at this point, and readPortalText prefers a
  // leftover staging file over a missing target, so a failure between these two
  // calls still recovers the newest portal on the next launch.
  if (target.exists) target.delete();
  await temp.move(target);
}

export async function readLegacyPortalText(): Promise<string | null> {
  const SecureStore = await import('expo-secure-store');
  return SecureStore.getItemAsync(LEGACY_PORTAL_STORAGE_KEY);
}

export async function clearLegacyPortal(): Promise<void> {
  const SecureStore = await import('expo-secure-store');
  await SecureStore.deleteItemAsync(LEGACY_PORTAL_STORAGE_KEY);
}
