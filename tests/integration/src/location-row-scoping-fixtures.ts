import { randomUUID } from 'node:crypto';

import { activateModule, createSignedInUser, seedBrand, sql } from './stack.ts';

/** Every id location-row-scoping-rls.test.ts asserts visibility against. */
export interface LocationScopingFixture {
  readonly brandId: string;
  readonly locationA: string;
  readonly locationB: string;
  readonly crewTaskA: string;
  readonly crewTaskBrandWide: string;
  readonly assignmentA: string;
  readonly assignmentBrandWide: string;
  readonly overrideA: string;
  readonly syncRunA: string;
  readonly syncRunBrandWide: string;
  readonly healthA: string;
  readonly healthBrandWide: string;
  readonly auditA: string;
  readonly auditBrandWide: string;
}

/**
 * Two stores under one brand, and a store-A / store-B / brand-wide row on
 * each of the six tables 20260912050000 fixed. Only the ids a test actually
 * asserts on come back; a store-B row still gets written for every table so
 * "never sees store B" has something real to fail against.
 */
export async function seedLocationScopingFixture(): Promise<LocationScopingFixture> {
  const seed = await seedBrand(`loc-scope-${randomUUID().slice(0, 8)}`);
  const brandId = seed.brandId;
  const locationA = seed.locationId;
  const locationB = (await sql<{ id: string }>(
    `insert into public.locations (brand_id, name, timezone) values ($1, 'Second', 'America/Denver') returning id`,
    [brandId],
  )).rows[0]!.id;

  const manager = await createSignedInUser({});
  const staff = await createSignedInUser({});
  await sql(
    `insert into public.brand_users (user_id, brand_id, role, location_ids)
     values ($1, $2, 'location_manager', array[$3::uuid])`,
    [manager.userId, brandId, locationA],
  );
  const staffBrandUserId = (await sql<{ id: string }>(
    `insert into public.brand_users (user_id, brand_id, role, location_ids)
     values ($1, $2, 'staff', array[$3::uuid]) returning id`,
    [staff.userId, brandId, locationA],
  )).rows[0]!.id;

  // crew_tasks.location_id is nullable: a null row is a brand-wide template
  // task, which app.is_brand_staff must still surface to every location.
  const [crewTaskA, crewTaskB, crewTaskBrandWide] = [randomUUID(), randomUUID(), randomUUID()];
  await sql(
    `insert into public.crew_tasks (id, brand_id, location_id, title) values
       ($1, $4, $5, 'Store A task'), ($2, $4, $6, 'Store B task'), ($3, $4, null, 'Brand-wide task')`,
    [crewTaskA, crewTaskB, crewTaskBrandWide, brandId, locationA, locationB],
  );

  const roleId = (await sql<{ id: string }>(
    `insert into public.workforce_roles (brand_id, slug, name) values ($1, 'barista', 'Barista') returning id`,
    [brandId],
  )).rows[0]!.id;
  const [assignmentA, assignmentB, assignmentBrandWide] = [randomUUID(), randomUUID(), randomUUID()];
  await sql(
    `insert into public.workforce_role_assignments
       (id, brand_id, brand_user_id, workforce_role_id, location_id) values
       ($1, $5, $6, $7, $3), ($2, $5, $6, $7, $4), ($8, $5, $6, $7, null)`,
    [assignmentA, assignmentB, locationA, locationB, brandId, staffBrandUserId, roleId, assignmentBrandWide],
  );

  // site_module_overrides.location_id is NOT NULL, so it has no brand-wide
  // row; the FK to module_installations needs a real installation, and
  // 20260903170000 makes the guarded writer the only way to get one.
  await activateModule(brandId, 'growth-drops');
  const [overrideA, overrideB] = [randomUUID(), randomUUID()];
  await sql(
    `insert into public.site_module_overrides (id, brand_id, location_id, module_key) values
       ($1, $3, $4, 'growth-drops'), ($2, $3, $5, 'growth-drops')`,
    [overrideA, overrideB, brandId, locationA, locationB],
  );

  const providerId = (await sql<{ id: string }>(`select id from public.connector_registry limit 1`)).rows[0]!.id;
  const connectorInstallationId = (await sql<{ id: string }>(
    `insert into public.connector_installations (brand_id, provider_id) values ($1, $2) returning id`,
    [brandId, providerId],
  )).rows[0]!.id;

  const [syncRunA, syncRunB, syncRunBrandWide] = [randomUUID(), randomUUID(), randomUUID()];
  await sql(
    `insert into public.connector_sync_runs
       (id, brand_id, installation_id, location_id, capability_key, direction, trigger_kind,
        correlation_id, idempotency_key) values
       ($1, $4, $5, $6, 'orders.sync', 'import', 'manual', gen_random_uuid(), 'idem-store-a-run'),
       ($2, $4, $5, $7, 'orders.sync', 'import', 'manual', gen_random_uuid(), 'idem-store-b-run'),
       ($3, $4, $5, null, 'orders.sync', 'import', 'manual', gen_random_uuid(), 'idem-brand-run')`,
    [syncRunA, syncRunB, syncRunBrandWide, brandId, connectorInstallationId, locationA, locationB],
  );

  const [healthA, healthB, healthBrandWide] = [randomUUID(), randomUUID(), randomUUID()];
  await sql(
    `insert into public.connector_health_snapshots (id, brand_id, installation_id, location_id, status) values
       ($1, $4, $5, $6, 'healthy'), ($2, $4, $5, $7, 'healthy'), ($3, $4, $5, null, 'healthy')`,
    [healthA, healthB, healthBrandWide, brandId, connectorInstallationId, locationA, locationB],
  );

  const [auditA, auditB, auditBrandWide] = [randomUUID(), randomUUID(), randomUUID()];
  await sql(
    `insert into public.connector_audit_events
       (id, brand_id, installation_id, location_id, action, outcome, correlation_id, source) values
       ($1, $4, $5, $6, 'connector.sync', 'success', gen_random_uuid(), 'system'),
       ($2, $4, $5, $7, 'connector.sync', 'success', gen_random_uuid(), 'system'),
       ($3, $4, $5, null, 'connector.sync', 'success', gen_random_uuid(), 'system')`,
    [auditA, auditB, auditBrandWide, brandId, connectorInstallationId, locationA, locationB],
  );

  return {
    brandId, locationA, locationB,
    crewTaskA, crewTaskBrandWide,
    assignmentA, assignmentBrandWide,
    overrideA,
    syncRunA, syncRunBrandWide,
    healthA, healthBrandWide,
    auditA, auditBrandWide,
  };
}
