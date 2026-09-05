import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';

import { asPrincipal } from './principal.ts';
import { anonClient, createSignedInUser, seedBrand, serviceClient, skipUnlessConfigured, sql } from './stack.ts';

type Session = Awaited<ReturnType<typeof createSignedInUser>>;

/** Draft an installation through the guarded writers, the only path there is. */
async function install(
  brandId: string, moduleKey: string, version: string, actor: string,
): Promise<string> {
  const created = await sql<{ create_module_installation: string }>(
    `select app.create_module_installation($1, $2, $3, null::jsonb, $4, $5)`,
    [brandId, moduleKey, version, actor, randomUUID()],
  );
  return created.rows[0]!.create_module_installation;
}

/** draft -> validating -> active, which is the shortest legal route. */
async function activate(
  brandId: string, moduleKey: string, version: string, actor: string,
): Promise<string> {
  const installationId = await install(brandId, moduleKey, version, actor);
  for (const [state, revision] of [['validating', 1], ['active', 2]] as const) {
    await sql(
      `select app.set_module_installation_state($1, $2, $3, null::jsonb, $4, $5, $6)`,
      [installationId, brandId, state, revision, actor, randomUUID()],
    );
  }
  return installationId;
}

/**
 * Phase 1b's promise: franchise surfaces are read-only to clients, network
 * membership never widens tenant RLS, and the aggregate RPC answers counts and
 * sums or nothing at all. Runs against the hosted test branch like the rest of
 * this suite; skips when no stack is configured.
 */
describe('module franchise RLS', { skip: skipUnlessConfigured }, () => {
  let brandA = '';
  let brandB = '';
  let networkId = '';
  let franchisor: Session;
  let delegate: Session;

  function staffClaims(userId: string, brandId: string) {
    return { sub: userId, app_metadata: { brand_id: brandId, role: 'brand_owner', location_ids: [] } };
  }

  before(async () => {
    const suffix = randomUUID().slice(0, 8);
    const a = await seedBrand(`modfr-a-${suffix}`);
    const b = await seedBrand(`modfr-b-${suffix}`);
    brandA = a.brandId;
    brandB = b.brandId;

    franchisor = await createSignedInUser({
      before: async (userId) => {
        await sql(
          `insert into public.brand_users (user_id, brand_id, role, location_ids)
           values ($1, $2, 'brand_owner', '{}')`,
          [userId, brandA],
        );
      },
    });
    delegate = await createSignedInUser({});

    networkId = (await sql<{ id: string }>(
      `insert into public.franchise_networks (slug, name) values ($1, 'Module test network') returning id`,
      [`modfr-${suffix}`],
    )).rows[0]!.id;
    await sql(
      `insert into public.franchise_memberships (network_id, user_id, role)
       values ($1, $2, 'franchisor_admin')`,
      [networkId, franchisor.userId],
    );
    await sql(
      `insert into public.franchise_network_brands
         (network_id, brand_id, added_by, status, accepted_by, accepted_at)
       values ($1, $2, $3, 'active', $3, now()),
              ($1, $4, $3, 'active', $3, now())`,
      [networkId, brandA, franchisor.userId, brandB],
    );
    // 20260903170000 closed the direct write path: the only way to an active
    // installation is create (draft) then two guarded transitions, which is
    // also what the fixtures should have been exercising all along.
    for (const [brandId, version] of [[brandA, '1.0.0'], [brandB, '1.2.0']] as const) {
      await activate(brandId, 'growth-loyalty', version, franchisor.userId);
    }
    // Brand B volume inside and outside the 30-day window, so the KPI
    // assertions can tell a real aggregate from an unfiltered dump.
    await sql(
      `insert into public.orders (brand_id, location_id, status, total_cents, subtotal_cents)
       values ($1, $2, 'paid', 1200, 1100), ($1, $2, 'paid', 800, 750)`,
      [brandB, b.locationId],
    );
    await sql(
      `insert into public.orders (brand_id, location_id, status, total_cents, subtotal_cents, created_at)
       values ($1, $2, 'paid', 5000, 4900, now() - interval '45 days')`,
      [brandB, b.locationId],
    );
  });

  after(async () => {
    // Deleting an installation cascades to its events; the append-only trigger
    // admits that referential cascade and nothing else.
    await sql(`delete from public.module_installations where brand_id = any ($1::uuid[])`, [[brandA, brandB]]);
    await sql(`delete from public.franchise_networks where id = $1`, [networkId]);
  });

  it('never shows one brand another brand’s module installations', async () => {
    const claims = staffClaims(franchisor.userId, brandA);
    const own = await asPrincipal(
      claims, `select id from public.module_installations where brand_id = $1`, [brandA]);
    assert.equal(own.rows.length, 1, 'staff read their own installations');
    const foreign = await asPrincipal(
      claims, `select id from public.module_installations where brand_id = $1`, [brandB]);
    assert.equal(foreign.rows.length, 0, 'brand B’s installations stay invisible');

    // The engine path still works: the service role reads across tenants.
    const service = serviceClient();
    const listed = await service.from('module_installations').select('id').eq('brand_id', brandB);
    assert.equal(listed.error, null);
    assert.equal(listed.data?.length, 1, 'the service role still drives the module surface');
  });

  it('does not let network membership read a member brand’s raw rows', async () => {
    const claims = staffClaims(franchisor.userId, brandA);
    const networks = await asPrincipal(
      claims, `select id from public.franchise_networks where id = $1`, [networkId]);
    assert.equal(networks.rows.length, 1, 'the membership really reads its network');
    const orders = await asPrincipal(claims, `select id from public.orders where brand_id = $1`, [brandB]);
    assert.equal(orders.rows.length, 0, 'orders of a member brand stay tenant-only');
  });

  it('refuses the network aggregate to an expired delegated grant', async () => {
    await sql(
      `insert into public.delegated_access_grants
         (brand_id, network_id, grantee_user_id, scope, created_by, expires_at, created_at)
       values ($1, $2, $3, '{network:kpis}', $4,
         now() - interval '1 day', now() - interval '2 days')`,
      [brandB, networkId, delegate.userId, franchisor.userId],
    );
    await assert.rejects(
      sql(`select brand_id from app.network_brand_kpis($1, $2)`, [networkId, delegate.userId]),
      (error) => {
        const failure = error as { code?: string; message?: string };
        assert.equal(failure.code, 'P0002');
        assert.match(failure.message ?? '', /network_access_denied/);
        return true;
      },
    );
  });

  it('limits a live delegated grant to the brands it covers', async () => {
    await sql(
      `insert into public.delegated_access_grants
         (brand_id, network_id, grantee_user_id, scope, created_by, expires_at)
       values ($1, $2, $3, '{network:kpis}', $4, now() + interval '10 days')`,
      [brandB, networkId, delegate.userId, franchisor.userId],
    );
    const rows = await sql<{ brand_id: string }>(
      `select brand_id from app.network_brand_kpis($1, $2)`, [networkId, delegate.userId]);
    assert.deepEqual(rows.rows.map((row) => row.brand_id), [brandB],
      'a grant covers its brand, not the network');
  });

  it('answers a network member aggregates only, never raw rows', async () => {
    const rows = await sql<Record<string, unknown>>(
      `select * from app.network_brand_kpis($1, $2)`, [networkId, franchisor.userId]);
    assert.equal(rows.rows.length, 2, 'a member aggregates every enrolled brand');
    for (const row of rows.rows) {
      assert.deepEqual(Object.keys(row).sort(), ['brand_id', 'gross_cents_30d', 'orders_30d'],
        'no order or customer field may ride along');
    }
    const brandRow = rows.rows.find((row) => row.brand_id === brandB)!;
    assert.equal(Number(brandRow.orders_30d), 2, 'the 45-day-old order is outside the window');
    assert.equal(Number(brandRow.gross_cents_30d), 2000);
  });

  it('keeps module installation events append-only', async () => {
    const installationId = await install(brandA, 'workforce-training', '0.9.0', franchisor.userId);
    // The guarded writer is the only way in: draft -> validating, revision
    // 1 -> 2, with the event recorded in the same transaction.
    const written = await sql<{ set_module_installation_state: number }>(
      `select app.set_module_installation_state($1, $2, 'validating', null::jsonb, 1, $3, $4)`,
      [installationId, brandA, franchisor.userId, randomUUID()]);
    assert.equal(written.rows[0]!.set_module_installation_state, 2);
    const event = (await sql<{ id: number }>(
      `select id from public.module_installation_events
        where installation_id = $1 and event = 'state.transition'`,
      [installationId])).rows[0]!;
    assert.ok(event, 'the transition recorded its event');

    const visible = await asPrincipal(
      staffClaims(franchisor.userId, brandA),
      `select id from public.module_installation_events where installation_id = $1`, [installationId]);
    assert.equal(visible.rows.length, 2, 'brand staff read their own event trail');
    const hidden = await asPrincipal(
      staffClaims(randomUUID(), brandB),
      `select id from public.module_installation_events where installation_id = $1`, [installationId]);
    assert.equal(hidden.rows.length, 0, 'another tenant does not');

    await assert.rejects(
      sql(`update public.module_installation_events set event = 'tampered' where id = $1`, [event.id]),
      /module_installation_event_append_only/);
    await assert.rejects(
      sql(`delete from public.module_installation_events where id = $1`, [event.id]),
      /module_installation_event_append_only/);
  });
});

/**
 * Phase 2.6a's promise: module_installations can carry authorization. The
 * table is writable only through the guarded writers, its keys are governed by
 * the registry, and a logged-out reader resolves capability without reaching
 * any of the operational detail the row also holds.
 */
describe('module installations as the authorization root', { skip: skipUnlessConfigured }, () => {
  let brandId = '';
  let slug = '';
  let actor: Session;

  before(async () => {
    slug = `modauth-${randomUUID().slice(0, 8)}`;
    brandId = (await seedBrand(slug)).brandId;
    actor = await createSignedInUser({});
    await activate(brandId, 'growth-drops', '1.0.0', actor.userId);
    // Kiosk-facing but not customer-facing: the projection must withhold it.
    await activate(brandId, 'device-wall', '1.0.0', actor.userId);
    // Active but staff-only, and the module the legacy `operations` flag maps
    // to -- a flag the storefront already refuses to publish.
    await activate(brandId, 'workforce-operations', '1.0.0', actor.userId);
  });

  after(async () => {
    await sql(`delete from public.module_installations where brand_id = $1`, [brandId]);
  });

  it('refuses a direct write even from a connection that owns the table', async () => {
    await assert.rejects(
      sql(`insert into public.module_installations (brand_id, module_key, version, state)
           values ($1, 'commerce-catalog', '1.0.0', 'active')`, [brandId]),
      /module_installation_guarded_writer_only/,
      'an insert that skips the writer skips the audit trail');
    await assert.rejects(
      sql(`update public.module_installations set state = 'active' where brand_id = $1`, [brandId]),
      /module_installation_guarded_writer_only/,
      'so does an update that skips the revision check');
  });

  it('refuses a module key no registry entry governs', async () => {
    await assert.rejects(
      sql(`select app.create_module_installation($1, 'commerce-teleport', '1.0.0', null::jsonb, null::uuid, $2)`,
        [brandId, randomUUID()]),
      /module_not_registered|module_installations_module_key_in_registry|violates foreign key/,
      'an ungoverned key would be an ungoverned permission set');
  });

  it('projects only active, customer-facing keys to an anonymous reader', async () => {
    const anon = anonClient();
    const projected = await anon.rpc('brand_storefront_capabilities', { p_slug: slug });
    assert.equal(projected.error, null);
    const rows = (projected.data ?? []) as { slug: string; module_key: string }[];
    assert.deepEqual(rows.map((row) => row.module_key).sort(), ['growth-drops'],
      'staff-only and kiosk-only modules stay unpublished');
    assert.deepEqual([...new Set(Object.keys(rows[0] ?? {}))].sort(), ['module_key', 'slug'],
      'no config, state, installer or timestamp rides along');
  });

  it('returns nothing to a reader that names no brand, and reads no row directly', async () => {
    const anon = anonClient();
    const unnamed = await anon.rpc('brand_storefront_capabilities', {});
    assert.equal(unnamed.error, null);
    assert.deepEqual(unnamed.data, [], 'a caller that forgets to narrow fails closed');
    const direct = await anon.from('module_installations').select('id');
    assert.ok(direct.error || (direct.data ?? []).length === 0,
      'the table itself stays unreadable to anon');
  });

  it('no longer publishes the stale brand_config.features blob', async () => {
    const anon = anonClient();
    const storefront = await anon
      .rpc('brand_storefront_lookup', { p_slug: slug })
      .maybeSingle<{ brand_config: Record<string, unknown> | null }>();
    assert.equal(storefront.error, null);
    assert.equal('features' in (storefront.data?.brand_config ?? {}), false,
      'the flag object that gates nothing must not outlive its editor');
  });
});
