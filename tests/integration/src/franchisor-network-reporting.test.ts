import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, after, describe, it } from 'node:test';

import { asPrincipal } from './principal.ts';
import { createSignedInUser, seedBrand, skipUnlessConfigured, sql } from './stack.ts';

type Session = Awaited<ReturnType<typeof createSignedInUser>>;
type Kpi = { brand_id: string; brand_name: string; orders_30d: string; gross_cents_30d: string };

/**
 * Phase 2.6c's promise: a franchisor reaches network aggregates holding nothing
 * but their own session. The interesting assertions here are the refusals --
 * the reason 20260903193000 introduced a new function instead of widening the
 * grant on app.network_brand_kpis is that the older form takes the user it
 * authorizes as an argument, so any client that could call it could name
 * somebody else. Both halves are tested: the caller-identity form answers only
 * for the session asking, and the argument-identity form stays unreachable.
 */
describe('franchisor network reporting', { skip: skipUnlessConfigured }, () => {
  let brandA = '';
  let brandB = '';
  let networkId = '';
  let franchisor: Session;
  let stranger: Session;
  let expiredDelegate: Session;
  let revokedDelegate: Session;
  let liveDelegate: Session;

  /** The whole point of the release: no service key, no impersonation. */
  function kpis(session: Session) {
    return asPrincipal<Kpi>(
      { sub: session.userId },
      `select * from public.caller_network_brand_kpis($1)`,
      [networkId],
    );
  }

  /**
   * A timestamp, not a SQL expression.
   *
   * These are bound parameters, so `now() + interval '10 days'` arrives as a
   * *string value* and PostgreSQL rejects it with `invalid input syntax for
   * type timestamp with time zone`. Three cases here passed SQL text and
   * failed on their first real run against a database. The parameter binding
   * is right and stays -- the value has to be computed on this side.
   */
  function daysFromNow(days: number): string {
    return new Date(Date.now() + days * 86_400_000).toISOString();
  }

  async function grant(
    session: Session, expiresAt: string, revokedAt: string | null,
  ): Promise<void> {
    await sql(
      `insert into public.delegated_access_grants
         (brand_id, network_id, grantee_user_id, scope, created_by, expires_at, revoked_at)
       values ($1, $2, $3, '{network:kpis}', $4, $5, $6)`,
      [brandB, networkId, session.userId, franchisor.userId, expiresAt, revokedAt],
    );
  }

  async function refused(session: Session, why: string): Promise<void> {
    await assert.rejects(kpis(session), (error) => {
      const failure = error as { code?: string; message?: string };
      assert.equal(failure.code, 'P0002', why);
      assert.match(failure.message ?? '', /network_access_denied/, why);
      return true;
    }, why);
  }

  before(async () => {
    const suffix = randomUUID().slice(0, 8);
    const a = await seedBrand(`fnrep-a-${suffix}`);
    const b = await seedBrand(`fnrep-b-${suffix}`);
    brandA = a.brandId;
    brandB = b.brandId;

    franchisor = await createSignedInUser({});
    stranger = await createSignedInUser({});
    expiredDelegate = await createSignedInUser({});
    revokedDelegate = await createSignedInUser({});
    liveDelegate = await createSignedInUser({});

    networkId = (await sql<{ id: string }>(
      `insert into public.franchise_networks (slug, name)
       values ($1, 'Network reporting test') returning id`,
      [`fnrep-${suffix}`],
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

    // Brand B carries volume on both sides of the 30-day boundary so the
    // aggregate can be told apart from an unfiltered dump; brand A carries
    // none, which is what proves the left join still reports a quiet brand.
    await sql(
      `insert into public.orders (brand_id, location_id, status, total_cents, subtotal_cents)
       values ($1, $2, 'paid', 1200, 1100), ($1, $2, 'paid', 800, 750)`,
      [brandB, b.locationId],
    );
    await sql(
      `insert into public.orders
         (brand_id, location_id, status, total_cents, subtotal_cents, created_at)
       values ($1, $2, 'paid', 5000, 4900, now() - interval '45 days')`,
      [brandB, b.locationId],
    );
  });

  after(async () => {
    // Grants cascade from the network, which is the only row this suite owns
    // outside the brands seedBrand already truncates on its next run.
    await sql(`delete from public.franchise_networks where id = $1`, [networkId]);
  });

  it('answers a network member for every enrolled brand', async () => {
    const rows = await kpis(franchisor);
    assert.equal(rows.rows.length, 2, 'a member aggregates the whole network');
    for (const row of rows.rows) {
      assert.deepEqual(Object.keys(row).sort(),
        ['brand_id', 'brand_name', 'gross_cents_30d', 'orders_30d'],
        'identity and aggregates only -- no order or customer field may ride along');
    }
    const busy = rows.rows.find((row) => row.brand_id === brandB)!;
    assert.equal(Number(busy.orders_30d), 2, 'the 45-day-old order is outside the window');
    assert.equal(Number(busy.gross_cents_30d), 2000);
    const quiet = rows.rows.find((row) => row.brand_id === brandA)!;
    assert.equal(Number(quiet.orders_30d), 0, 'a brand with no orders still reports');
    assert.equal(Number(quiet.gross_cents_30d), 0);
  });

  it('refuses a user who holds no grant at all', async () => {
    await refused(stranger, 'a signed-in stranger is not a franchisor');
  });

  it('refuses an expired grant', async () => {
    await grant(expiredDelegate, daysFromNow(-1), null);
    await refused(expiredDelegate, 'a grant that ran out authorizes nothing');
  });

  it('refuses a revoked grant that has not yet expired', async () => {
    await grant(revokedDelegate, daysFromNow(10), new Date().toISOString());
    await refused(revokedDelegate, 'revocation ends the relationship immediately');
  });

  it('limits a live grant to the brands it names', async () => {
    await grant(liveDelegate, daysFromNow(10), null);
    const rows = await kpis(liveDelegate);
    assert.deepEqual(rows.rows.map((row) => row.brand_id), [brandB],
      'a grant covers its brand, not the network');
    assert.equal(Number(rows.rows[0]!.gross_cents_30d), 2000,
      'a delegate reads the same number the franchisor reads');
  });

  it('keeps the argument-identity form unreachable from a client session', async () => {
    // If this ever passes, the caller chooses whose network it reads and every
    // refusal above becomes decorative.
    await assert.rejects(
      asPrincipal(
        { sub: franchisor.userId },
        `select * from app.network_brand_kpis($1, $2)`,
        [networkId, franchisor.userId],
      ),
      (error) => {
        const failure = error as { code?: string };
        assert.equal(failure.code, '42501', 'authenticated must not execute it');
        return true;
      },
      'even a genuine franchisor goes through the caller-identity form',
    );
  });
});
