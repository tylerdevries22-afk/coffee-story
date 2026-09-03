import assert from 'node:assert/strict';
import test from 'node:test';

import type { PortalBundle } from '@platform/domain';

import { createDemoPortalStore, parseStoredPortal, type PortalTextStore } from './index';

/**
 * Covers the load/save orchestration that was previously duplicated and
 * untested -- in particular the one-time migration of a portal persisted
 * through SecureStore before the blob outgrew its ~2 KB iOS value limit.
 */
const SEED: PortalBundle = {
  role: 'client',
  profile: {
    id: 'guest-1', fullName: 'Test Guest', email: 'guest@example.test',
    phone: null, birthday: null, avatarUrl: null,
  },
  orders: [],
  rewardAccount: {
    availablePoints: 0, annualPoints: 0, cashCents: 0,
    annualPeriodStart: '2026-01-01T00:00:00.000Z',
  },
  rewardLedger: [],
  rewardActivities: [],
  rewardCatalog: [],
  giftCards: [],
};

const seed = {
  createInitial: (): PortalBundle => structuredClone(SEED),
  migrate: (portal: PortalBundle): PortalBundle => ({ ...portal, autoPromptDismissed: false }),
};

type Fake = PortalTextStore & { readonly written: Map<string, string> };

function fakeStore(overrides: Partial<PortalTextStore> = {}): Fake {
  const written = new Map<string, string>();
  return {
    written,
    readAppMode: async () => written.get('mode') ?? null,
    writeAppMode: async (mode) => void written.set('mode', mode),
    readPortalText: async () => written.get('portal') ?? null,
    writePortalText: async (json) => void written.set('portal', json),
    readLegacyPortalText: async () => written.get('legacy') ?? null,
    clearLegacyPortal: async () => void written.delete('legacy'),
    ...overrides,
  };
}

test('the portal and the app mode round-trip through separate slots', async () => {
  const store = fakeStore();
  const demo = createDemoPortalStore(store, seed);
  await demo.saveStoredAppMode('live');
  await demo.saveStoredPortal(seed.migrate(seed.createInitial()));
  assert.equal(await demo.loadStoredAppMode(), 'live');
  assert.deepEqual(await demo.loadStoredPortal(), seed.migrate(SEED));
});

test('an app-mode read that throws degrades to unset rather than failing launch', async () => {
  const demo = createDemoPortalStore(
    fakeStore({ readAppMode: async () => { throw new Error('keychain locked'); } }),
    seed,
  );
  assert.equal(await demo.loadStoredAppMode(), null);
});

test('a portal left behind in SecureStore is migrated forward once and then cleared', async () => {
  const store = fakeStore();
  store.written.set('legacy', JSON.stringify(SEED));
  const demo = createDemoPortalStore(store, seed);
  assert.deepEqual(await demo.loadStoredPortal(), seed.migrate(SEED));
  // Rewritten to the file store and dropped from SecureStore, so the next
  // launch reads the file and the oversized value stops being retried.
  assert.equal(store.written.has('legacy'), false);
  assert.deepEqual(parseStoredPortal(store.written.get('portal') ?? null, seed.migrate), seed.migrate(SEED));
});

test('an unreadable primary store still recovers the legacy value', async () => {
  const store = fakeStore({ readPortalText: async () => { throw new Error('unreadable'); } });
  store.written.set('legacy', JSON.stringify(SEED));
  assert.deepEqual(await createDemoPortalStore(store, seed).loadStoredPortal(), seed.migrate(SEED));
});

test('nothing stored anywhere loads as nothing, not as a throw', async () => {
  assert.equal(await createDemoPortalStore(fakeStore(), seed).loadStoredPortal(), null);
});

test('a corrupt portal is discarded instead of hydrated', async () => {
  const store = fakeStore();
  store.written.set('portal', '{"profile":{"id":"guest-1"}');
  assert.equal(await createDemoPortalStore(store, seed).loadStoredPortal(), null);
});

test('a reset seeds a fresh portal and returns the app to demo mode', async () => {
  const store = fakeStore();
  store.written.set('mode', 'live');
  const next = await createDemoPortalStore(store, seed).resetStoredDemoPortal();
  assert.deepEqual(next, SEED);
  assert.equal(store.written.get('mode'), 'demo');
  assert.equal(store.written.get('portal'), JSON.stringify(SEED));
});
