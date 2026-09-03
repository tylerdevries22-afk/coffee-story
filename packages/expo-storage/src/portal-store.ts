import type { PortalTextStore } from '@platform/offline';

import {
  DEMO_PORTAL_FILE_NAME,
  DEMO_PORTAL_TEMP_FILE_NAME,
  type PortalStoreKeys,
} from './portal-store-keys';

/**
 * Native persistence for the demo portal, shared by the customer and operator
 * apps, which carried byte-identical copies of this file.
 *
 * The parsers and the load/save orchestration live in `@platform/offline`
 * because HQ and the pickup display import that package; this module owns the
 * only thing that is native -- the file and secure-store handles -- which is
 * the same split `analytics-queue-store.ts` beside it makes.
 *
 * `portal-store.web.ts` substitutes for this file on web: expo-file-system and
 * expo-secure-store have no web implementation, and the browser demo would
 * otherwise start from scratch on every reload. Metro resolves that variant
 * through this package's barrel -- see the platform-extension note in
 * `AGENTS.md`.
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

async function readPortalText(): Promise<string | null> {
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

async function writePortalText(json: string): Promise<void> {
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

export function portalStore(keys: PortalStoreKeys): PortalTextStore {
  return Object.freeze({
    readAppMode: async () => {
      const SecureStore = await import('expo-secure-store');
      return SecureStore.getItemAsync(keys.appModeKey);
    },
    writeAppMode: async (mode: string) => {
      const SecureStore = await import('expo-secure-store');
      await SecureStore.setItemAsync(keys.appModeKey, mode);
    },
    readPortalText,
    writePortalText,
    readLegacyPortalText: async () => {
      const SecureStore = await import('expo-secure-store');
      return SecureStore.getItemAsync(keys.legacyPortalKey);
    },
    clearLegacyPortal: async () => {
      const SecureStore = await import('expo-secure-store');
      await SecureStore.deleteItemAsync(keys.legacyPortalKey);
    },
  });
}
