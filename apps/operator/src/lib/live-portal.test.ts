import assert from 'node:assert/strict';
import test from 'node:test';

import { operationsInstalled } from '@/lib/live-portal';
import { DISABLED_OPERATIONS } from '@/state/operations-state';

const BRAND = '20000000-0000-4000-8000-000000000001';

test('an active workforce-operations installation is the capability', async () => {
  assert.equal(
    await operationsInstalled(async () => ({
      data: [{ module_key: 'workforce-operations' }],
      error: null,
    }), BRAND),
    true,
  );
});

test('no installation is no capability', async () => {
  assert.equal(await operationsInstalled(async () => ({ data: [], error: null }), BRAND), false);
});

/**
 * The case that separates this from a plain truthiness check. A failed read is
 * not an absent module, and collapsing the two is how a transient network
 * error hands a tenant a shift board it never installed -- the same two-case
 * rule apps/hq/lib/capabilities.ts states for the console.
 */
test('a failed capability read denies rather than grants', async () => {
  assert.equal(
    await operationsInstalled(async () => ({ data: null, error: new Error('offline') }), BRAND),
    false,
  );
  assert.equal(
    await operationsInstalled(async () => ({ data: null, error: null }), BRAND),
    false,
  );
  assert.equal(
    await operationsInstalled(async () => ({
      data: [{ module_key: 'workforce-operations' }],
      error: new Error('partial'),
    }), BRAND),
    false,
    'an error alongside rows is still an error',
  );
});

test('the brand it asks about is the brand it was given', async () => {
  let asked = '';
  await operationsInstalled(async (brandId) => {
    asked = brandId;
    return { data: [], error: null };
  }, BRAND);
  assert.equal(asked, BRAND);
});

/**
 * The staff layout only mounts OperationsProvider for a brand that has the
 * module, so every screen beneath it can render without one. This is the
 * answer they get, and it has to be inert rather than thrown: a crash here
 * would take the orders board down over a module the tenant does not use.
 */
test('the unmounted board is empty, disabled, and safe to call', async () => {
  assert.equal(DISABLED_OPERATIONS.enabled, false);
  assert.equal(DISABLED_OPERATIONS.loading, false);
  assert.equal(DISABLED_OPERATIONS.error, null);
  assert.deepEqual([...DISABLED_OPERATIONS.occurrences], []);
  assert.deepEqual([...DISABLED_OPERATIONS.notifications], []);
  assert.deepEqual([...DISABLED_OPERATIONS.conflicts], []);
  assert.equal(DISABLED_OPERATIONS.unreadCount, 0);
  assert.equal(DISABLED_OPERATIONS.pendingCount, 0);
  await DISABLED_OPERATIONS.refresh();
  await DISABLED_OPERATIONS.claim('occurrence');
  await DISABLED_OPERATIONS.release('occurrence');
  await DISABLED_OPERATIONS.discardConflict('action');
});
