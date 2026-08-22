import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

import { APP_MODE_STORAGE_KEY, DEMO_PORTAL_FILE_NAME } from './demo-storage-keys';
import {
  clearLegacyPortal,
  readAppMode,
  readLegacyPortalText,
  readPortalText,
  writeAppMode,
  writePortalText,
} from './portal-store.web';

/**
 * Exercises the web persistence layer against a stand-in localStorage.
 *
 * The module reads `localStorage` off the global at call time, so installing a
 * fake here is enough — no bundler or module mocking involved.
 */
type Store = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

const globals = globalThis as { localStorage?: Store };
const original = globals.localStorage;

function useStorage(store: Store | undefined) {
  if (store === undefined) delete globals.localStorage;
  else globals.localStorage = store;
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
  await writePortalText('{"role":"client"}');
  assert.equal(await readPortalText(), '{"role":"client"}');
});

test('reading before anything is written returns null, not a throw', async () => {
  assert.equal(await readPortalText(), null);
  assert.equal(await readAppMode(), null);
});

test('the app mode round-trips independently of the portal', async () => {
  await writeAppMode('live');
  await writePortalText('{"role":"staff"}');
  assert.equal(await readAppMode(), 'live');
  assert.equal(await readPortalText(), '{"role":"staff"}');
});

test('portal and app mode use separate keys', async () => {
  const fake = memoryStorage();
  useStorage(fake);
  await writeAppMode('demo');
  await writePortalText('{"role":"client"}');
  assert.equal(fake.data.get(APP_MODE_STORAGE_KEY), 'demo');
  assert.equal(fake.data.get(DEMO_PORTAL_FILE_NAME), '{"role":"client"}');
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
  await assert.doesNotReject(() => writePortalText('{"role":"client"}'));
  assert.equal(await readPortalText(), null);
});

test('no localStorage at all is survivable', async () => {
  useStorage(undefined);
  await assert.doesNotReject(() => writeAppMode('demo'));
  assert.equal(await readAppMode(), null);
});

test('there is no legacy SecureStore data to migrate on web', async () => {
  assert.equal(await readLegacyPortalText(), null);
  await assert.doesNotReject(() => clearLegacyPortal());
});
