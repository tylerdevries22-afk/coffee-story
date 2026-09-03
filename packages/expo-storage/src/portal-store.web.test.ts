import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

import { DEMO_PORTAL_FILE_NAME } from './portal-store-keys';
import { portalStore } from './portal-store.web';

/**
 * Exercises the web persistence layer against a stand-in localStorage.
 *
 * The module reads `localStorage` off the global at call time, so installing a
 * fake here is enough -- no bundler or module mocking involved.
 */
type Store = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

const APP_MODE_KEY = 'platform.test.app-mode.v1';
const LEGACY_PORTAL_KEY = 'platform.test.demo-portal.v1';
const store = portalStore({ appModeKey: APP_MODE_KEY, legacyPortalKey: LEGACY_PORTAL_KEY });

const globals = globalThis as { localStorage?: Store };
const original = globals.localStorage;

function useStorage(fake: Store | undefined) {
  if (fake === undefined) delete globals.localStorage;
  else globals.localStorage = fake;
}

function memoryStorage(): Store & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
}

beforeEach(() => useStorage(memoryStorage()));
afterEach(() => useStorage(original));

test('a portal round-trips through storage', async () => {
  await store.writePortalText('{"role":"client"}');
  assert.equal(await store.readPortalText(), '{"role":"client"}');
});

test('reading before anything is written returns null, not a throw', async () => {
  assert.equal(await store.readPortalText(), null);
  assert.equal(await store.readAppMode(), null);
});

test('the app mode round-trips independently of the portal', async () => {
  await store.writeAppMode('live');
  await store.writePortalText('{"role":"staff"}');
  assert.equal(await store.readAppMode(), 'live');
  assert.equal(await store.readPortalText(), '{"role":"staff"}');
});

test('portal and app mode use separate keys', async () => {
  const fake = memoryStorage();
  useStorage(fake);
  await store.writeAppMode('demo');
  await store.writePortalText('{"role":"client"}');
  assert.equal(fake.data.get(APP_MODE_KEY), 'demo');
  assert.equal(fake.data.get(DEMO_PORTAL_FILE_NAME), '{"role":"client"}');
});

test('two apps sharing this package keep their own app-mode slot', async () => {
  const fake = memoryStorage();
  useStorage(fake);
  const other = portalStore({ appModeKey: 'platform.other.app-mode.v1', legacyPortalKey: LEGACY_PORTAL_KEY });
  await store.writeAppMode('live');
  await other.writeAppMode('demo');
  assert.equal(await store.readAppMode(), 'live');
  assert.equal(await other.readAppMode(), 'demo');
});

test('a storage that throws degrades to starting fresh', async () => {
  // Safari in private browsing throws on access rather than returning null.
  useStorage({
    getItem() {
      throw new Error('SecurityError');
    },
    setItem() {
      throw new Error('QuotaExceededError');
    },
  });
  await assert.doesNotReject(() => store.writePortalText('{"role":"client"}'));
  assert.equal(await store.readPortalText(), null);
});

test('no localStorage at all is survivable', async () => {
  useStorage(undefined);
  await assert.doesNotReject(() => store.writeAppMode('demo'));
  assert.equal(await store.readAppMode(), null);
});

test('there is no legacy SecureStore data to migrate on web', async () => {
  assert.equal(await store.readLegacyPortalText(), null);
  await assert.doesNotReject(() => store.clearLegacyPortal());
});
