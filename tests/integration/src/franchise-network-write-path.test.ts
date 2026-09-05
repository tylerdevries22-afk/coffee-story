import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';

import { asPrincipal, asPrincipalSequence } from './principal.ts';
import { createSignedInUser, seedBrand, skipUnlessConfigured, sql } from './stack.ts';

type Session = Awaited<ReturnType<typeof createSignedInUser>>;

/**
 * The four writers 20260904010000 added, exercised as the roles that are meant
 * to reach them and the roles that are not.
 *
 * Before this release nothing under apps/, packages/ or scripts/ wrote any of
 * the franchise tables, and nothing at all could write `revoked_at` early --
 * `prune_delegated_access_grants` only back-dates grants that have already run
 * out. So the assertions that matter most here are the refusals, and the
 * revocation returning true once and false the second time.
 *
 * `asPrincipal` rolls its transaction back and runs one statement, so most
 * cases are stated as one
 * statement whose RESULT is the assertion. Where the effect of a write has to
 * be observed, the fixture seeds the prior state through `sql` and the writer's
 * own return value reports what it did.
 */
describe('franchise network write path', { skip: skipUnlessConfigured }, () => {
  let enrolledBrand = '';
  let outsideBrand = '';
  let networkId = '';
  let operator: Session;
  let franchisor: Session;
  let brandOwner: Session;
  let stranger: Session;
  let grantee: Session;
  let liveGrantId = '';
  let endedGrantId = '';

  /** The claim shape `app.is_brand_owner` reads: app_metadata, not the token root. */
  function ownerClaims(userId: string, brandId: string) {
    return { sub: userId, app_metadata: { brand_id: brandId, role: 'brand_owner', location_ids: [] } };
  }

  async function refused(
    claims: Record<string, unknown>, statement: string, params: unknown[],
    code: string, message: RegExp, why: string,
  ): Promise<void> {
    await assert.rejects(asPrincipal(claims, statement, params), (error) => {
      const failure = error as { code?: string; message?: string };
      assert.equal(failure.code, code, why);
      assert.match(failure.message ?? '', message, why);
      return true;
    }, why);
  }

  before(async () => {
    const suffix = randomUUID().slice(0, 8);
    const enrolled = await seedBrand(`fnwrite-a-${suffix}`);
    const outside = await seedBrand(`fnwrite-b-${suffix}`);
    enrolledBrand = enrolled.brandId;
    outsideBrand = outside.brandId;

    // A platform administrator is a brand_users row, not a claim, because that
    // is what create_platform_organization checks and what these four copy.
    // The owner connection carries no JWT, so protect_platform_admin_grant
    // admits the seed (20260824072313).
    operator = await createSignedInUser({
      before: async (userId) => {
        await sql(
          `insert into public.brand_users (user_id, brand_id, role, location_ids)
           values ($1, $2, 'platform_admin', '{}')`,
          [userId, enrolledBrand],
        );
      },
    });
    franchisor = await createSignedInUser({});
    brandOwner = await createSignedInUser({
      before: async (userId) => {
        await sql(
          `insert into public.brand_users (user_id, brand_id, role, location_ids)
           values ($1, $2, 'brand_owner', '{}')`,
          [userId, enrolledBrand],
        );
      },
    });
    stranger = await createSignedInUser({});
    grantee = await createSignedInUser({});

    networkId = (await sql<{ id: string }>(
      `insert into public.franchise_networks (slug, name)
       values ($1, 'Write path test network') returning id`,
      [`fnwrite-${suffix}`],
    )).rows[0]!.id;
    await sql(
      `insert into public.franchise_memberships (network_id, user_id, role)
       values ($1, $2, 'franchisor_admin')`,
      [networkId, franchisor.userId],
    );
    await sql(
      `insert into public.franchise_network_brands (network_id, brand_id, added_by)
       values ($1, $2, $3)`,
      [networkId, enrolledBrand, franchisor.userId],
    );

    liveGrantId = (await sql<{ id: string }>(
      `insert into public.delegated_access_grants
         (brand_id, network_id, grantee_user_id, scope, created_by, expires_at)
       values ($1, $2, $3, '{network:kpis}', $4, now() + interval '10 days')
       returning id`,
      [enrolledBrand, networkId, grantee.userId, brandOwner.userId],
    )).rows[0]!.id;
    endedGrantId = (await sql<{ id: string }>(
      `insert into public.delegated_access_grants
         (brand_id, network_id, grantee_user_id, scope, created_by, expires_at, revoked_at)
       values ($1, $2, $3, '{network:kpis}', $4, now() + interval '10 days', now())
       returning id`,
      [enrolledBrand, networkId, grantee.userId, brandOwner.userId],
    )).rows[0]!.id;
  });

  after(async () => {
    // Grants, memberships and enrolments all cascade from the network, which
    // is the only row this suite owns outside the brands seedBrand re-seeds.
    await sql(`delete from public.franchise_networks where id = $1`, [networkId]);
  });

  it('creates a network and enrols its creator as franchisor_admin', async () => {
    const slug = `fnwrite-ok-${randomUUID().slice(0, 6)}`;
    // Two statements in one transaction, not a CTE. PostgreSQL takes one
    // snapshot per statement, so a data-modifying CTE's effects are invisible
    // to a sibling subquery in the same statement -- the earlier CTE form here
    // asserted `null` against a function that was in fact writing the row.
    // Read-committed gives each statement a fresh snapshot, so the second one
    // sees the first's uncommitted write, and the rollback still cleans up.
    const [created, membership] = await asPrincipalSequence<{ id: string; role: string | null }>(
      { sub: operator.userId },
      [
        { text: `select public.create_franchise_network($1, $2) as id`,
          params: ['Write path new network', slug] },
        // Keyed on the slug, which is known before the call: the statements are
        // handed over as a batch, so the second cannot reference the first's
        // returned id. The slug is unique and randomised per run.
        { text: `select membership.role
                   from public.franchise_memberships membership
                   join public.franchise_networks network
                     on network.id = membership.network_id
                  where network.slug = $1 and membership.user_id = $2`,
          params: [slug, operator.userId] },
      ],
    );
    const createdId = created!.rows[0]!.id;
    assert.match(createdId, /^[0-9a-f-]{36}$/);
    assert.equal(membership!.rows[0]?.role, 'franchisor_admin',
      'a network nobody administers is a network nobody can read');

    await refused(
      { sub: operator.userId },
      `select public.create_franchise_network($1, $2)`,
      ['Bad handle', 'Not A Slug'], '22023', /invalid_franchise_network/,
      'the slug CHECK is restated so the caller learns what it did wrong',
    );
  });

  it('refuses network creation to anyone but a platform administrator', async () => {
    for (const [who, session] of [['a stranger', stranger], ['a franchisor', franchisor],
      ['a brand owner', brandOwner]] as const) {
      await refused(
        { sub: session.userId, app_metadata: { brand_id: enrolledBrand, role: 'brand_owner' } },
        `select public.create_franchise_network($1, $2)`,
        ['Not allowed', `fnwrite-deny-${randomUUID().slice(0, 6)}`],
        '42501', /platform_actor_required/, `${who} may not create a network`,
      );
    }
  });

  it('enrols a brand once, and reports the second call as a no-op', async () => {
    const first = await asPrincipal<{ enroll_brand_in_network: boolean }>(
      { sub: franchisor.userId },
      `select public.enroll_brand_in_network($1, $2)`,
      [networkId, outsideBrand],
    );
    assert.equal(first.rows[0]!.enroll_brand_in_network, true);
    // enrolledBrand is already in the network from the fixture, which is the
    // second call without depending on the rolled-back one above.
    const again = await asPrincipal<{ enroll_brand_in_network: boolean }>(
      { sub: franchisor.userId },
      `select public.enroll_brand_in_network($1, $2)`,
      [networkId, enrolledBrand],
    );
    assert.equal(again.rows[0]!.enroll_brand_in_network, false,
      'a repeat enrolment is a no-op rather than a 23505');
  });

  it('refuses enrolment to a brand owner and to a stranger', async () => {
    for (const [who, claims] of [
      ['the enrolling brand\'s own owner', ownerClaims(brandOwner.userId, enrolledBrand)],
      ['a signed-in stranger', { sub: stranger.userId }],
    ] as const) {
      await refused(claims, `select public.enroll_brand_in_network($1, $2)`,
        [networkId, outsideBrand], '42501', /network_admin_required/,
        `${who} may not enrol a brand`);
    }
  });

  it('lends a brand idempotently, only inside its network and for 30 days', async () => {
    const idempotencyKey = randomUUID();
    const [granted, replayed] = await asPrincipalSequence<{ grant_delegated_access: string }>(
      ownerClaims(brandOwner.userId, enrolledBrand),
      [
        {
          text: `select public.grant_delegated_access(
            $1, $2, $3, '{network:kpis}', now() + interval '10 days', $4)`,
          params: [networkId, enrolledBrand, stranger.userId, idempotencyKey],
        },
        {
          text: `select public.grant_delegated_access(
            $1, $2, $3, '{network:kpis}', now() + interval '10 days', $4)`,
          params: [networkId, enrolledBrand, stranger.userId, idempotencyKey],
        },
      ],
    );
    const grantId = granted!.rows[0]!.grant_delegated_access;
    assert.match(grantId, /^[0-9a-f-]{36}$/);
    assert.equal(replayed!.rows[0]!.grant_delegated_access, grantId,
      'replaying the same request returns the original grant');

    await refused(
      ownerClaims(brandOwner.userId, outsideBrand),
      `select public.grant_delegated_access(
        $1, $2, $3, '{network:kpis}', now() + interval '10 days', $4)`,
      [networkId, outsideBrand, stranger.userId, randomUUID()],
      '23514', /delegated_brand_outside_network/,
      'a grant over a brand the network never enrolled authorizes nothing',
    );
    await refused(
      ownerClaims(brandOwner.userId, enrolledBrand),
      `select public.grant_delegated_access(
        $1, $2, $3, '{network:kpis}', now() + interval '31 days', $4)`,
      [networkId, enrolledBrand, stranger.userId, randomUUID()],
      '22023', /invalid_delegated_grant/,
      'the current grant contract rejects expiry outside its 30-day ceiling',
    );
    await refused(
      ownerClaims(brandOwner.userId, enrolledBrand),
      `select public.grant_delegated_access(
        $1, $2, $3, '{not a scope}', now() + interval '5 days', $4)`,
      [networkId, enrolledBrand, stranger.userId, randomUUID()],
      '22023', /invalid_delegated_grant/,
      'the current grant contract rejects a scope outside the grammar',
    );
    await refused(
      { sub: franchisor.userId },
      `select public.grant_delegated_access(
        $1, $2, $3, '{network:kpis}', now() + interval '5 days', $4)`,
      [networkId, enrolledBrand, stranger.userId, randomUUID()],
      '42501', /brand_owner_required/,
      'the network that benefits from a grant may not issue itself one',
    );
  });

  /**
   * The function this release exists for. Until it landed, ending a delegation
   * early was not something the platform could do: `revoked_at` was written
   * only by the retention sweep, and only for grants whose `expires_at` had
   * already passed.
   */
  it('ends a live grant, and treats an already-ended one as a no-op', async () => {
    const revoked = await asPrincipal<{ revoke_delegated_access: boolean }>(
      ownerClaims(brandOwner.userId, enrolledBrand),
      `select public.revoke_delegated_access($1)`,
      [liveGrantId],
    );
    assert.equal(revoked.rows[0]!.revoke_delegated_access, true);

    const again = await asPrincipal<{ revoke_delegated_access: boolean }>(
      ownerClaims(brandOwner.userId, enrolledBrand),
      `select public.revoke_delegated_access($1)`,
      [endedGrantId],
    );
    assert.equal(again.rows[0]!.revoke_delegated_access, false,
      'revoking an ended grant changes nothing and raises nothing');
  });

  it('refuses revocation to the grantee, a stranger, and another brand\'s owner', async () => {
    for (const [who, claims] of [
      ['the grantee', { sub: grantee.userId }],
      ['a stranger', { sub: stranger.userId }],
      ['another brand\'s owner', ownerClaims(brandOwner.userId, outsideBrand)],
      ['the network\'s franchisor', { sub: franchisor.userId }],
    ] as const) {
      await refused(claims, `select public.revoke_delegated_access($1)`,
        [liveGrantId], '42501', /brand_owner_required/,
        `${who} may not end a grant the brand issued`);
    }
  });

  it('reports a grant nobody issued as missing rather than as a refusal', async () => {
    await refused(
      ownerClaims(brandOwner.userId, enrolledBrand),
      `select public.revoke_delegated_access($1)`,
      [randomUUID()], '23503', /delegated_grant_not_found/,
      'an unknown grant id is a missing row, not an authorization answer',
    );
  });
});
