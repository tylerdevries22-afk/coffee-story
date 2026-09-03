import type { PortalBundle } from '@platform/domain';

import { parseStoredPortal } from './demo-portal';

/**
 * The on-device handles this orchestration needs, declared here rather than in
 * the package that implements them.
 *
 * `@platform/expo-storage` supplies a native and a web implementation; the
 * write-then-rename file dance and the localStorage fallback are the only
 * platform-specific parts, and nothing here may import a native module, so HQ
 * and the pickup display can still reach this package.
 */
export type PortalTextStore = {
  readAppMode(): Promise<string | null>;
  writeAppMode(mode: string): Promise<void>;
  readPortalText(): Promise<string | null>;
  writePortalText(json: string): Promise<void>;
  readLegacyPortalText(): Promise<string | null>;
  clearLegacyPortal(): Promise<void>;
};

/** The app's own preview seed, which is the only thing that differs per app. */
export type DemoPortalSeed = {
  createInitial(): PortalBundle;
  migrate(portal: PortalBundle): PortalBundle;
};

export type DemoPortalStore = {
  loadStoredAppMode(): Promise<string | null>;
  saveStoredAppMode(mode: 'demo' | 'live'): Promise<void>;
  loadStoredPortal(): Promise<PortalBundle | null>;
  saveStoredPortal(portal: PortalBundle): Promise<void>;
  resetStoredDemoPortal(): Promise<PortalBundle>;
};

export function createDemoPortalStore(store: PortalTextStore, seed: DemoPortalSeed): DemoPortalStore {
  const loadStoredAppMode = async (): Promise<string | null> => {
    try {
      return await store.readAppMode();
    } catch {
      return null;
    }
  };

  const saveStoredAppMode = async (mode: 'demo' | 'live'): Promise<void> => {
    await store.writeAppMode(mode);
  };

  const saveStoredPortal = async (portal: PortalBundle): Promise<void> => {
    await store.writePortalText(JSON.stringify(portal));
  };

  const loadStoredPortal = async (): Promise<PortalBundle | null> => {
    try {
      const parsed = parseStoredPortal(await store.readPortalText(), seed.migrate);
      if (parsed) return parsed;
    } catch {
      // Unreadable store -- fall through to the legacy migration below.
    }
    // One-time migration of any portal persisted via SecureStore before the portal
    // blob moved to file storage. A legacy value that cannot be read or migrated is
    // abandoned rather than blocking hydration.
    try {
      const migrated = parseStoredPortal(await store.readLegacyPortalText(), seed.migrate);
      if (migrated) {
        await saveStoredPortal(migrated);
        await store.clearLegacyPortal();
      }
      return migrated;
    } catch {
      return null;
    }
  };

  return Object.freeze({
    loadStoredAppMode,
    saveStoredAppMode,
    loadStoredPortal,
    saveStoredPortal,
    resetStoredDemoPortal: async (): Promise<PortalBundle> => {
      const next = seed.createInitial();
      await Promise.all([saveStoredAppMode('demo'), saveStoredPortal(next)]);
      return next;
    },
  });
}
