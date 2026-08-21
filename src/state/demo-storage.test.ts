import assert from 'node:assert/strict';
import test from 'node:test';

import { createInitialDemoPortal } from './demo-state';
import { parseStoredAppMode, parseStoredPortal } from './demo-storage';

function legacyRewardsPayload(): string {
  const portal = createInitialDemoPortal();
  const legacy = JSON.parse(JSON.stringify(portal)) as Record<string, unknown>;
  // A legacy rewards blob could already have been stamped v3 by the previous
  // additive migration, so reward normalization must not trust the version.
  legacy.demoStateVersion = 3;

  const account = legacy.rewardAccount as Record<string, unknown>;
  account.availableCrumbs = account.availablePoints;
  account.annualCrumbs = account.annualPoints;
  delete account.availablePoints;
  delete account.annualPoints;

  legacy.rewardLedger = (legacy.rewardLedger as Record<string, unknown>[]).map((entry) => {
    const migrated: Record<string, unknown> = { ...entry, crumbs: entry.points };
    delete migrated.points;
    return migrated;
  });
  legacy.rewardCatalog = (legacy.rewardCatalog as Record<string, unknown>[]).map((item) => {
    const migrated: Record<string, unknown> = { ...item, crumbsCost: item.pointsCost };
    delete migrated.pointsCost;
    return migrated;
  });
  return JSON.stringify(legacy);
}

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
    appointments: [{ ...portal.appointments[0], startsAt: 'not-a-date' }],
  })), null);
  assert.equal(parseStoredPortal(JSON.stringify({
    ...portal,
    appointments: [{ ...portal.appointments[0], bookingSource: 'unknown' }],
  })), null);
});

test('parseStoredPortal migrates the complete pre-points reward schema', () => {
  const migrated = parseStoredPortal(legacyRewardsPayload());
  assert.ok(migrated);
  assert.equal(migrated.demoStateVersion, 4);
  assert.equal(migrated.autoPromptDismissed, false);
  assert.equal(migrated.profile.avatarUrl, null);
  assert.equal(migrated.rewardAccount.availablePoints, 1376);
  assert.equal(migrated.rewardAccount.annualPoints, 1876);
  assert.equal(migrated.rewardLedger[0]?.points, 91);
  assert.equal(migrated.rewardLedger[4]?.points, -500);
  assert.equal(migrated.rewardCatalog[0]?.pointsCost, 500);
});

test('parseStoredPortal prefers valid canonical reward values over stale aliases', () => {
  const portal = createInitialDemoPortal();
  const mixed = JSON.parse(JSON.stringify(portal)) as Record<string, unknown>;
  const account = mixed.rewardAccount as Record<string, unknown>;
  account.availablePoints = 0;
  account.availableCrumbs = 9999;
  const ledger = mixed.rewardLedger as Record<string, unknown>[];
  ledger[0] = { ...ledger[0], points: -25, crumbs: 9999 };

  const parsed = parseStoredPortal(JSON.stringify(mixed));
  assert.ok(parsed);
  assert.equal(parsed.rewardAccount.availablePoints, 0);
  assert.equal(parsed.rewardLedger[0]?.points, -25);
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
  assert.equal(migrated?.demoStateVersion, 4);
  assert.equal(migrated?.profile.avatarUrl, null);
  assert.equal(migrated?.autoPromptDismissed, false);
});

test('parseStoredAppMode honors the stored mode and live-config fallback', () => {
  assert.equal(parseStoredAppMode('live', true), 'live');
  assert.equal(parseStoredAppMode('live', false), 'demo');
  assert.equal(parseStoredAppMode('demo', true), 'demo');
  assert.equal(parseStoredAppMode(null, true), 'demo');
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
  } finally {
    globalThis.window = originalWindow;
  }
});
