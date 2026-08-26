import assert from 'node:assert/strict';
import test from 'node:test';

import { createInitialDemoPortal } from './demo-state';
import { parseStoredAppMode, parseStoredPortal } from './demo-storage';

test('parseStoredPortal returns null for missing or corrupt payloads', () => {
  assert.equal(parseStoredPortal(null), null);
  assert.equal(parseStoredPortal(''), null);
  assert.equal(parseStoredPortal('{not json'), null);
  assert.equal(parseStoredPortal('42'), null);
  assert.equal(parseStoredPortal('"client"'), null);
});

test('parseStoredPortal rejects a structurally incomplete portal instead of hydrating it', () => {
  // A `role` key alone used to be enough to accept the blob. A portal written by
  // an older build -- here one predating `rewardActivities` -- then hydrated and
  // threw during render, and because the same file reloads every launch with no
  // error boundary anywhere, the app crash-looped with no way to reset.
  const portal = createInitialDemoPortal();
  const withoutActivities: Record<string, unknown> = { ...portal };
  delete withoutActivities.rewardActivities;
  assert.equal(parseStoredPortal(JSON.stringify(withoutActivities)), null);

  const withoutProfile: Record<string, unknown> = { ...portal };
  delete withoutProfile.profile;
  assert.equal(parseStoredPortal(JSON.stringify(withoutProfile)), null);

  // An array field arriving as the wrong type must not pass either.
  assert.equal(parseStoredPortal(JSON.stringify({ ...portal, giftCards: {} })), null);
  assert.equal(parseStoredPortal(JSON.stringify({ role: 'client' })), null);
  assert.equal(parseStoredPortal(JSON.stringify({ ...portal, profile: {} })), null);
  assert.equal(parseStoredPortal(JSON.stringify({ ...portal, rewardAccount: {} })), null);
  assert.equal(parseStoredPortal(JSON.stringify({ ...portal, role: 'owner' })), null);
  assert.equal(parseStoredPortal(JSON.stringify({
    ...portal,
    rewardLedger: [{ ...portal.rewardLedger[0], points: undefined }],
  })), null);
  assert.equal(parseStoredPortal(JSON.stringify({
    ...portal,
    orders: [{ ...portal.orders[0], placedAt: 'not-a-date' }],
  })), null);
  assert.equal(parseStoredPortal(JSON.stringify({
    ...portal,
    orders: [{ ...portal.orders[0], fulfillmentType: 'teleport' }],
  })), null);
  // A line's option list must be strings; a malformed cart snapshot re-seeds
  // rather than reaching a receipt.
  assert.equal(parseStoredPortal(JSON.stringify({
    ...portal,
    orders: [{ ...portal.orders[0], lines: [{ name: 'x', quantity: 1, unitPriceCents: 1, options: [7] }] }],
  })), null);
  // null scheduledFor is legal -- an asap order has no pickup window.
  assert.ok(parseStoredPortal(JSON.stringify({
    ...portal,
    orders: [{ ...portal.orders[0], scheduledFor: null }],
  })));
});

test('parseStoredPortal round-trips a production-scale portal larger than the SecureStore limit', () => {
  const portal = createInitialDemoPortal();
  const raw = JSON.stringify(portal);
  // expo-secure-store only guarantees ~2 KB values on iOS; the demo portal is
  // persisted as a file precisely because it exceeds that limit.
  assert.ok(Buffer.byteLength(raw, 'utf8') > 2048);
  assert.deepEqual(parseStoredPortal(raw), portal);
});

test('parseStoredPortal migrates automatic setup dismissal safely', () => {
  const portal = createInitialDemoPortal();
  delete portal.demoStateVersion;
  delete portal.autoPromptDismissed;
  const migrated = parseStoredPortal(JSON.stringify(portal));
  assert.equal(migrated?.demoStateVersion, 5);
  assert.equal(migrated?.profile.avatarUrl, null);
  assert.equal(migrated?.autoPromptDismissed, false);
});

test('parseStoredAppMode honors the stored mode and live-config fallback', () => {
  assert.equal(parseStoredAppMode('live', true), 'live');
  assert.equal(parseStoredAppMode('live', false), 'demo');
  assert.equal(parseStoredAppMode('demo', true), 'demo');
});

test('parseStoredAppMode opens a configured build on live, an unconfigured one on demo', () => {
  // With nothing stored, the build decides. This used to be 'demo' either way,
  // and since nothing in the app ever called chooseLive, a production build
  // with real credentials still booted into fabricated data and never showed
  // the sign-in screen.
  assert.equal(parseStoredAppMode(null, true), 'live');
  assert.equal(parseStoredAppMode(null, false), 'demo');
});

test('parseStoredAppMode never defaults Expo Go to live', () => {
  // Expo Go cannot run the native payment flows live mode needs, and a preview
  // channel published with the owner's Supabase variables would otherwise hand
  // every reviewer who scans the QR a sign-in screen for an account they do
  // not have.
  assert.equal(parseStoredAppMode(null, true, true), 'demo');
  assert.equal(parseStoredAppMode(null, false, true), 'demo');
});

test('an explicit live choice still wins inside Expo Go', () => {
  assert.equal(parseStoredAppMode('live', true, true), 'live');
  assert.equal(parseStoredAppMode('live', false, true), 'demo');
});

test('parseStoredAppMode treats an unrecognized stored value as unset', () => {
  assert.equal(parseStoredAppMode('nonsense', true), 'live');
  assert.equal(parseStoredAppMode('nonsense', false), 'demo');
});

test('an explicit demo choice survives a build that could go live', () => {
  // Someone who picked Demo from More stays there on the next launch.
  assert.equal(parseStoredAppMode('demo', true), 'demo');
});

test('parseStoredAppMode forces demo mode for /demo shell URLs', () => {
  const originalWindow = globalThis.window;
  // @ts-expect-error -- test-only polyfill for the web path sentinel in demo mode.
  globalThis.window = { location: { pathname: '/demo' } };

  try {
    assert.equal(parseStoredAppMode('live', true), 'demo');
    assert.equal(parseStoredAppMode('demo', true), 'demo');
    assert.equal(parseStoredAppMode(null, true), 'demo');
  } finally {
    globalThis.window = originalWindow;
  }
});

test('parseStoredAppMode tolerates a React Native window without location', () => {
  const originalWindow = globalThis.window;
  // @ts-expect-error -- Expo Go exposes a window-like global without a browser location.
  globalThis.window = {};

  try {
    assert.equal(parseStoredAppMode(null, false), 'demo');
    assert.equal(parseStoredAppMode(null, true), 'live');
  } finally {
    globalThis.window = originalWindow;
  }
});
