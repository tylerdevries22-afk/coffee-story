import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';

import {
  anonClient, createSignedInUser, seedBrand, skipUnlessConfigured, sql, userClient,
} from './stack.ts';

type Fixture = {
  brandId: string;
  locationId: string;
  owner: Awaited<ReturnType<typeof createSignedInUser>>;
  admin: Awaited<ReturnType<typeof createSignedInUser>>;
};

/**
 * A brand, a brand_owner of it, and a platform admin.
 *
 * Both memberships are inserted before sign-in so app.custom_access_token mints
 * the role into the token; the admin's platform_admin row goes in on the owner
 * connection, where app.jwt_role() is null and protect_platform_admin_grant
 * therefore permits it.
 */
async function fixture(tag: string): Promise<Fixture> {
  const brand = await seedBrand(`susp-${tag}-${randomUUID().slice(0, 8)}`);
  const member = (role: string) => async (userId: string) => {
    await sql(
      `insert into public.brand_users (user_id, brand_id, role, location_ids)
       values ($1, $2, $3, $4)`,
      [userId, brand.brandId, role, role === 'brand_owner' ? [brand.locationId] : []],
    );
  };
  return {
    ...brand,
    owner: await createSignedInUser({ before: member('brand_owner') }),
    admin: await createSignedInUser({ before: member('platform_admin') }),
  };
}

async function statusOf(brandId: string): Promise<string> {
  const row = await sql<{ status: string }>(
    'select status from public.brands where id = $1', [brandId],
  );
  return row.rows[0]!.status;
}

/** One paired iPad, so revocation has something to revoke. */
async function installDevice(brandId: string, locationId: string, userId: string): Promise<string> {
  const created = await sql<{ id: string }>(
    `insert into public.device_installations (
       id, brand_id, location_id, installed_by, label, form_factor, app_target,
       platform, app_version, runtime_version, capabilities, identity_fingerprint
     ) values (gen_random_uuid(), $1, $2, $3, 'Counter iPad', 'tablet', 'operator',
       'ios', '1.0.0', 'exposdk-54.0.0', array['heartbeat'], $4)
     returning id`,
    [brandId, locationId, userId, randomUUID().replaceAll('-', '').padEnd(64, '0')],
  );
  return created.rows[0]!.id;
}

/** A live 'network:kpis' delegation, the thing that outlives a separation by 30 days. */
async function delegateKpis(brandId: string, granteeId: string, tag: string): Promise<string> {
  const network = await sql<{ id: string }>(
    `insert into public.franchise_networks (slug, name) values ($1, 'Suspension network')
     returning id`,
    [`susp-net-${tag}-${randomUUID().slice(0, 6)}`],
  );
  const networkId = network.rows[0]!.id;
  await sql(
    `insert into public.franchise_network_brands (network_id, brand_id, added_by)
     values ($1, $2, $3)`,
    [networkId, brandId, granteeId],
  );
  const grant = await sql<{ id: string }>(
    `insert into public.delegated_access_grants
       (brand_id, network_id, grantee_user_id, scope, created_by, expires_at)
     values ($1, $2, $3, array['network:kpis'], $3, now() + interval '20 days')
     returning id`,
    [brandId, networkId, granteeId],
  );
  return grant.rows[0]!.id;
}

/**
 * Phase 2.7's promise: a suspended brand's staff lose every read while a
 * platform admin keeps theirs, and suspension revokes rather than deletes.
 *
 * Runs against the hosted test branch like the rest of this suite and skips
 * when no stack is configured. Written before any of it had been executed: the
 * migration is unapplied at the time of authoring, so this suite is the first
 * thing that will actually run the RPCs.
 */
describe('brand suspension RLS', { skip: skipUnlessConfigured }, () => {
  it('denies a suspended brand every staff read while a platform admin keeps his', async () => {
    const { brandId, owner, admin } = await fixture('reads');

    // Baseline first, so the denial below cannot pass vacuously -- a staff read
    // that was already empty would prove nothing about suspension.
    const before = await userClient(owner.accessToken).from('brands').select('id');
    assert.equal(before.error, null, before.error?.message);
    assert.deepEqual((before.data ?? []).map((row) => row.id), [brandId],
      'the owner reads his own brand while it is active');

    const suspended = await userClient(admin.accessToken)
      .rpc('suspend_brand', { p_brand_id: brandId, p_reason: 'franchise agreement terminated' });
    assert.equal(suspended.error, null, suspended.error?.message);
    assert.equal(suspended.data, true);
    assert.equal(await statusOf(brandId), 'suspended');

    // brands_select is `is_platform_admin() or is_brand_staff(id)`, so once the
    // helper answers false the owner cannot even see that his brand exists.
    const after = await userClient(owner.accessToken).from('brands').select('id');
    assert.equal(after.error, null, after.error?.message);
    assert.deepEqual(after.data, [], 'a suspended brand is invisible to its own owner');

    // The admin path must survive, or whoever suspends a brand cannot restore it.
    const asAdmin = await userClient(admin.accessToken).from('brands').select('id').eq('id', brandId);
    assert.equal(asAdmin.error, null, asAdmin.error?.message);
    assert.deepEqual((asAdmin.data ?? []).map((row) => row.id), [brandId],
      'a platform admin keeps the brand he just suspended');

    // is_brand_owner and at_location are gated too, so the write paths that do
    // not go through is_brand_staff are closed as well.
    const write = await userClient(owner.accessToken)
      .from('locations').insert({ brand_id: brandId, name: 'New site', timezone: 'America/Denver' });
    assert.notEqual(write.error, null, 'a suspended brand owner can still create a location');
  });

  it('revokes every device and delegated grant, and writes exactly one audit row', async () => {
    const { brandId, locationId, owner, admin } = await fixture('revoke');
    const installationId = await installDevice(brandId, locationId, owner.userId);
    const grantId = await delegateKpis(brandId, owner.userId, 'revoke');

    const suspended = await userClient(admin.accessToken)
      .rpc('suspend_brand', { p_brand_id: brandId, p_reason: 'non-payment, 60 days' });
    assert.equal(suspended.error, null, suspended.error?.message);

    const device = await sql<{ revoked_at: string | null }>(
      'select revoked_at from public.device_installations where id = $1', [installationId],
    );
    assert.notEqual(device.rows[0]!.revoked_at, null, 'the iPad keeps syncing');

    const grant = await sql<{ revoked_at: string | null }>(
      'select revoked_at from public.delegated_access_grants where id = $1', [grantId],
    );
    assert.notEqual(grant.rows[0]!.revoked_at, null, 'the analyst keeps reading network KPIs');

    const audit = await sql<{ metadata: Record<string, unknown>; actor_id: string }>(
      `select metadata, actor_id from public.platform_access_events
        where brand_id = $1 and action = 'brands.suspend'`,
      [brandId],
    );
    assert.equal(audit.rowCount, 1, 'one suspension, one audit row');
    assert.equal(audit.rows[0]!.actor_id, admin.userId, 'the actor came from auth.uid()');
    assert.equal(audit.rows[0]!.metadata.reason, 'non-payment, 60 days');
    assert.equal(audit.rows[0]!.metadata.devices_revoked, 1);
    assert.equal(audit.rows[0]!.metadata.grants_revoked, 1);

    // Idempotent: a second call is not an event.
    const again = await userClient(admin.accessToken)
      .rpc('suspend_brand', { p_brand_id: brandId, p_reason: 'non-payment, 60 days' });
    assert.equal(again.error, null, again.error?.message);
    assert.equal(again.data, false, 'a re-suspension reports that it changed nothing');
    const rows = await sql(
      `select 1 from public.platform_access_events
        where brand_id = $1 and action = 'brands.suspend'`,
      [brandId],
    );
    assert.equal(rows.rowCount, 1, 'the second call wrote a duplicate audit row');
  });

  it('restores authorization without un-revoking a device, and is idempotent', async () => {
    const { brandId, locationId, owner, admin } = await fixture('restore');
    const installationId = await installDevice(brandId, locationId, owner.userId);
    await userClient(admin.accessToken)
      .rpc('suspend_brand', { p_brand_id: brandId, p_reason: 'suspended in error' });

    const restored = await userClient(admin.accessToken).rpc('restore_brand', { p_brand_id: brandId });
    assert.equal(restored.error, null, restored.error?.message);
    assert.equal(restored.data, true);
    assert.equal(await statusOf(brandId), 'active');

    const back = await userClient(owner.accessToken).from('brands').select('id');
    assert.deepEqual((back.data ?? []).map((row) => row.id), [brandId],
      'restoring returns the owner his reads');

    // revoked_at is a historical fact; the iPad re-pairs through its own flow.
    const device = await sql<{ revoked_at: string | null }>(
      'select revoked_at from public.device_installations where id = $1', [installationId],
    );
    assert.notEqual(device.rows[0]!.revoked_at, null,
      'restore rewrote history to claim the device was never cut off');

    const again = await userClient(admin.accessToken).rpc('restore_brand', { p_brand_id: brandId });
    assert.equal(again.data, false, 'restoring an active brand reports no change');
  });

  it('refuses a brand owner and is unreachable without a session', async () => {
    const { brandId, owner } = await fixture('authz');

    // The owner holds a real session and a platform_admin id is not secret, but
    // the actor comes from auth.uid() rather than an argument, so there is
    // nothing for him to pass.
    const asOwner = await userClient(owner.accessToken)
      .rpc('suspend_brand', { p_brand_id: brandId, p_reason: 'suspending my own franchisor' });
    assert.notEqual(asOwner.error, null, 'a brand owner suspended a brand');
    assert.equal(await statusOf(brandId), 'active');

    const asAnon = await anonClient()
      .rpc('suspend_brand', { p_brand_id: brandId, p_reason: 'anonymous suspension' });
    assert.notEqual(asAnon.error, null, 'anon can suspend a brand');
    assert.equal(await statusOf(brandId), 'active');
  });

  it('leaves the memberships and history a contested separation needs', async () => {
    const { brandId, admin } = await fixture('evidence');
    await userClient(admin.accessToken)
      .rpc('suspend_brand', { p_brand_id: brandId, p_reason: 'separation, disputed' });

    const members = await sql(
      'select 1 from public.brand_users where brand_id = $1', [brandId],
    );
    assert.equal(members.rowCount, 2,
      'suspension deleted a membership, destroying the record of who held access');
  });
});
