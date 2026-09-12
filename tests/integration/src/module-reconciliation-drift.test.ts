import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { seedBrand, sql, stack } from './stack.ts';

type InstallationRow = { module_key: string; state: string };

async function installations(brandId: string): Promise<InstallationRow[]> {
  const result = await sql<InstallationRow>(
    `select module_key, state from public.module_installations where brand_id = $1 order by module_key`,
    [brandId],
  );
  return result.rows;
}

function manifest(keys: readonly string[]): string {
  return JSON.stringify(keys.map((key) => ({ key, version: '1.0.0' })));
}

async function reconcile(brandId: string, keys: readonly string[]): Promise<number> {
  const result = await sql<{ reconcile_brand_modules: number }>(
    `select public.reconcile_brand_modules($1, $2::jsonb)`,
    [brandId, manifest(keys)],
  );
  return result.rows[0]!.reconcile_brand_modules;
}

/**
 * SQL-level regression for the disable-on-drift loop in
 * public.reconcile_brand_modules (20260904100345_franchise_provisioning_
 * contract.sql:574-584): any installation whose module_key falls out of the
 * desired manifest is driven to 'disabled' via
 * app.set_module_installation_state, which only allows a transition INTO
 * 'disabled' from any source state (20260903170000:256, "or p_to_state =
 * 'disabled'"). tests/consistency/src/onboard-module-reconciliation.test.ts
 * mocks the database and has never actually run this trigger-backed
 * lifecycle -- this is the platform's delivery gate for "a module a brand
 * dropped actually turns off."
 */
describe('reconcile_brand_modules disables dropped installations', { skip: !stack.dbUrl }, () => {
  it('drives a 3-module brand down to 1, disabling exactly the other two', async () => {
    const { brandId } = await seedBrand('reconcile-drift');

    const up = await reconcile(brandId, ['commerce-catalog', 'commerce-ordering', 'growth-loyalty']);
    assert.equal(up, 3, 'all three fresh installs are counted as changes');
    assert.deepEqual(await installations(brandId), [
      { module_key: 'commerce-catalog', state: 'active' },
      { module_key: 'commerce-ordering', state: 'active' },
      { module_key: 'growth-loyalty', state: 'active' },
    ], 'install_brand_module drives a new installation to active');

    const down = await reconcile(brandId, ['commerce-catalog']);
    assert.equal(down, 2, 'exactly the two dropped modules count as changes');
    assert.deepEqual(await installations(brandId), [
      { module_key: 'commerce-catalog', state: 'active' },
      { module_key: 'commerce-ordering', state: 'disabled' },
      { module_key: 'growth-loyalty', state: 'disabled' },
    ], 'dropping a module from the desired manifest must disable it, not leave it active');

    const events = await sql<{ count: string }>(
      `select count(*)::text as count from public.module_installation_events
        where brand_id = $1 and to_state = 'disabled'`,
      [brandId],
    );
    assert.equal(events.rows[0]!.count, '2', 'each drift-disable is audited exactly once');
  });

  it('is idempotent: reconciling the already-disabled state again disables nothing further', async () => {
    const { brandId } = await seedBrand('reconcile-idem');
    await reconcile(brandId, ['commerce-catalog', 'commerce-ordering']);
    await reconcile(brandId, ['commerce-catalog']);

    const again = await reconcile(brandId, ['commerce-catalog']);
    assert.equal(again, 0, 'an already-disabled installation must not recount or re-fire');
    assert.deepEqual(await installations(brandId), [
      { module_key: 'commerce-catalog', state: 'active' },
      { module_key: 'commerce-ordering', state: 'disabled' },
    ]);
  });
});
