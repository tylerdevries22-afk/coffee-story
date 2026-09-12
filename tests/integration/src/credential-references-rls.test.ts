import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';

import { asPrincipal } from './principal.ts';
import { seedBrand, sql, stack } from './stack.ts';

/**
 * Regression for 20260827192547_franchise_analytics_connectors.sql: item
 * `credential_references_service` (:1241) is the ONLY policy on the table,
 * scoped `to service_role`, and :1286-1290 revokes every table privilege
 * from anon and authenticated with no re-grant for credential_references
 * anywhere in that migration (:1294-1335 grants select/write on the
 * neighbouring connector_* tables but names credential_references only in
 * the revoke). No table privilege at all means the denial is a hard
 * permission error, not an RLS-filtered empty read -- the same shape as
 * square_connections. 20260827192944 later renamed the free-text
 * `secret_handle` column to a Vault-UUID `vault_secret_id`; that rename does
 * not change the privilege picture this file asserts. This table has never
 * been exercised as a signed-in principal in tests/integration.
 */
describe('credential_references RLS', { skip: !stack.dbUrl }, () => {
  async function fixture(tag: string) {
    const { brandId } = await seedBrand(`credref-${tag}`);
    // on conflict: a rerun against a kept local database must not collide on
    // this global (not brand-scoped) unique key, the same reasoning as
    // seedBrand's own on-conflict upsert.
    const provider = await sql<{ id: string }>(
      `insert into public.connector_registry
         (provider_key, display_name, category, logo_path, logo_source_url, logo_license)
       values ($1, 'Test Provider', 'platform', '/logo.png', 'https://example.test/logo.png', 'MIT')
       on conflict (provider_key) do update set display_name = excluded.display_name
       returning id`,
      [`credref-provider-${tag}`],
    );
    const providerId = provider.rows[0]!.id;
    const credential = await sql<{ id: string }>(
      `insert into public.credential_references (brand_id, provider_id, vault_secret_id)
       values ($1, $2, $3) returning id`,
      [brandId, providerId, randomUUID()],
    );
    return { brandId, providerId, credentialId: credential.rows[0]!.id };
  }

  it('denies a brand_owner every read and write, even against their own brand\'s row', async () => {
    const { brandId, providerId, credentialId } = await fixture('own');
    const claims = { app_metadata: { brand_id: brandId, role: 'brand_owner' } };

    await assert.rejects(
      asPrincipal(claims, `select vault_secret_id from public.credential_references where id = $1`, [credentialId]),
      /permission denied/, 'a brand_owner read the vault secret id',
    );
    await assert.rejects(
      asPrincipal(claims,
        `insert into public.credential_references (brand_id, provider_id, vault_secret_id)
         values ($1, $2, $3)`, [brandId, providerId, randomUUID()]),
      /permission denied/, 'a brand_owner inserted a credential reference',
    );
    await assert.rejects(
      asPrincipal(claims,
        `update public.credential_references set revoked_at = now() where id = $1`, [credentialId]),
      /permission denied/, 'a brand_owner revoked a credential reference directly',
    );
    await assert.rejects(
      asPrincipal(claims, `delete from public.credential_references where id = $1`, [credentialId]),
      /permission denied/, 'a brand_owner deleted a credential reference',
    );

    const survives = await sql('select 1 from public.credential_references where id = $1', [credentialId]);
    assert.equal(survives.rowCount, 1, 'the credential row must survive every attempt above');
  });

  it('denies platform_admin too, and a cross-brand read still returns nothing', async () => {
    const { brandId: brandA, credentialId } = await fixture('cross-a');
    const { brandId: brandB } = await seedBrand('credref-cross-b');

    await assert.rejects(
      asPrincipal({ app_metadata: { brand_id: brandA, role: 'platform_admin' } },
        `select id from public.credential_references where id = $1`, [credentialId]),
      /permission denied/, 'platform_admin bypassed the service-only policy',
    );
    await assert.rejects(
      asPrincipal({ app_metadata: { brand_id: brandB, role: 'brand_owner' } },
        `select id from public.credential_references where brand_id = $1`, [brandA]),
      /permission denied/, 'a brand B owner read across the tenant boundary',
    );
  });
});
