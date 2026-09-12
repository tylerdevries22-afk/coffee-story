import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

import { seedLocationScopingFixture, type LocationScopingFixture } from './location-row-scoping-fixtures.ts';
import { asPrincipal } from './principal.ts';
import { skipUnlessConfigured } from './stack.ts';

/**
 * 20260912050000 fixed six tables whose SELECT policy checked brand_id only,
 * even though each carries a location_id -- so a location_manager or staff
 * member at one store could read every other store's rows on the same
 * brand. It also closed locations_update, which admitted 'staff' through
 * app.at_location and so let a barista rewrite the shop's public name,
 * address, hours, and its square_connection_id pointer.
 *
 * asPrincipal runs a raw statement as role `authenticated` with fabricated
 * request.jwt.claims -- the same mechanism PostgREST evaluates policies
 * under -- so this proves the policy predicate itself, independent of the
 * claims-hook and HTTP layer that claims-hook.test.ts and rls-matrix.test.ts
 * already cover. Fixture setup lives in location-row-scoping-fixtures.ts.
 */
describe('location-scoped row RLS (20260912050000)', { skip: skipUnlessConfigured }, () => {
  let fixture: LocationScopingFixture;

  function managerClaims() {
    return {
      app_metadata: { brand_id: fixture.brandId, role: 'location_manager', location_ids: [fixture.locationA] },
    };
  }
  function staffClaims() {
    return { app_metadata: { brand_id: fixture.brandId, role: 'staff', location_ids: [fixture.locationA] } };
  }

  /** Asserts a principal's visible id set on a table, order-independent. */
  async function visibleIds(claims: Record<string, unknown>, table: string): Promise<string[]> {
    const result = await asPrincipal<{ id: string }>(claims, `select id from public.${table}`);
    return result.rows.map((row) => row.id).sort();
  }

  before(async () => {
    fixture = await seedLocationScopingFixture();
  });

  // This fixture includes immutable connector and module audit history.
  // Its unique brand remains until the disposable test database is destroyed,
  // matching the other append-only integration fixtures. Cascading a brand
  // deletion here correctly fails the production immutability guards.

  it('crew_tasks: a manager at store A sees store A and the brand-wide task, never store B', async () => {
    assert.deepEqual(
      await visibleIds(managerClaims(), 'crew_tasks'),
      [fixture.crewTaskA, fixture.crewTaskBrandWide].sort(),
    );
  });

  it('crew_tasks: staff at store A keep the same visibility the drift named them in', async () => {
    assert.deepEqual(
      await visibleIds(staffClaims(), 'crew_tasks'),
      [fixture.crewTaskA, fixture.crewTaskBrandWide].sort(),
    );
  });

  it('workforce_role_assignments: a manager at store A never sees store B', async () => {
    assert.deepEqual(
      await visibleIds(managerClaims(), 'workforce_role_assignments'),
      [fixture.assignmentA, fixture.assignmentBrandWide].sort(),
    );
  });

  it("site_module_overrides: a manager at store A sees only store A's override", async () => {
    assert.deepEqual(await visibleIds(managerClaims(), 'site_module_overrides'), [fixture.overrideA]);
  });

  it("connector_sync_runs: a manager at store A never sees store B's runs", async () => {
    assert.deepEqual(
      await visibleIds(managerClaims(), 'connector_sync_runs'),
      [fixture.syncRunA, fixture.syncRunBrandWide].sort(),
    );
  });

  it("connector_health_snapshots: a manager at store A never sees store B's snapshots", async () => {
    assert.deepEqual(
      await visibleIds(managerClaims(), 'connector_health_snapshots'),
      [fixture.healthA, fixture.healthBrandWide].sort(),
    );
  });

  it("connector_audit_events: a manager at store A never sees store B's audit trail", async () => {
    assert.deepEqual(
      await visibleIds(managerClaims(), 'connector_audit_events'),
      [fixture.auditA, fixture.auditBrandWide].sort(),
    );
  });

  it('locations_update: a manager updates their own store, never the other one', async () => {
    const updated = await asPrincipal<{ id: string }>(
      managerClaims(),
      `update public.locations set name = name || ' (touched)' where id in ($1, $2) returning id`,
      [fixture.locationA, fixture.locationB],
    );
    assert.deepEqual(updated.rows.map((row) => row.id), [fixture.locationA]);
  });

  it('locations_update: staff cannot update any location, their own store included', async () => {
    const updated = await asPrincipal<{ id: string }>(
      staffClaims(),
      `update public.locations set name = name || ' (touched)' where id in ($1, $2) returning id`,
      [fixture.locationA, fixture.locationB],
    );
    assert.deepEqual(updated.rows, []);
  });
});
