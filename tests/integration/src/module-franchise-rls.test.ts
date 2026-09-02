import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';

import { asPrincipal, createSignedInUser, seedBrand, serviceClient, skipUnlessConfigured, sql } from './stack.ts';

type Session = Awaited<ReturnType<typeof createSignedInUser>>;

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
      `insert into public.franchise_network_brands (network_id, brand_id, added_by)
       values ($1, $2, $3), ($1, $4, $3)`,
      [networkId, brandA, franchisor.userId, brandB],
    );
    await sql(
      `insert into public.module_installations (brand_id, module_key, version, state, installed_by)
       values ($1, 'loyalty', '1.0.0', 'active', $3), ($2, 'loyalty', '1.2.0', 'active', $3)`,
      [brandA, brandB, franchisor.userId],
    );
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
         (brand_id, network_id, grantee_user_id, scope, created_by, expires_at)
       values ($1, $2, $3, '{network:kpis}', $4, now() - interval '1 day')`,
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
    const installation = (await sql<{ id: string }>(
      `insert into public.module_installations (brand_id, module_key, version)
       values ($1, 'kds', '0.9.0') returning id`, [brandA])).rows[0]!;
    // The guarded writer is the only way in: draft -> validating, revision
    // 1 -> 2, with the event recorded in the same transaction.
    const written = await sql<{ set_module_installation_state: number }>(
      `select app.set_module_installation_state($1, $2, 'validating', null::jsonb, 1, $3, $4)`,
      [installation.id, brandA, franchisor.userId, randomUUID()]);
    assert.equal(written.rows[0]!.set_module_installation_state, 2);
    const event = (await sql<{ id: number }>(
      `select id from public.module_installation_events where installation_id = $1`,
      [installation.id])).rows[0]!;
    assert.ok(event, 'the transition recorded its event');

    const visible = await asPrincipal(
      staffClaims(franchisor.userId, brandA),
      `select id from public.module_installation_events where installation_id = $1`, [installation.id]);
    assert.equal(visible.rows.length, 1, 'brand staff read their own event trail');
    const hidden = await asPrincipal(
      staffClaims(randomUUID(), brandB),
      `select id from public.module_installation_events where installation_id = $1`, [installation.id]);
    assert.equal(hidden.rows.length, 0, 'another tenant does not');

    await assert.rejects(
      sql(`update public.module_installation_events set event = 'tampered' where id = $1`, [event.id]),
      /module_installation_event_append_only/);
    await assert.rejects(
      sql(`delete from public.module_installation_events where id = $1`, [event.id]),
      /module_installation_event_append_only/);
  });
});
