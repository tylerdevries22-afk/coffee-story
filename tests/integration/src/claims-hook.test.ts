import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createSignedInUser, seedBrand, skipUnlessConfigured, sql } from './stack.ts';

describe('custom access token hook', { skip: skipUnlessConfigured }, () => {
  it('mints staff claims from brand_users', async () => {
    const { brandId, locationId } = await seedBrand('hook-staff');
    const { claims } = await createSignedInUser({
      before: async (userId) => {
        await sql(
          `insert into public.brand_users (user_id, brand_id, role, location_ids)
           values ($1, $2, 'location_manager', array[$3::uuid])`,
          [userId, brandId, locationId],
        );
      },
    });
    assert.equal(claims.brand_id, brandId);
    assert.equal(claims.role, 'location_manager');
    assert.deepEqual(claims.location_ids, [locationId]);
    assert.equal(claims.brand_name, 'Test hook-staff');
  });

  it('mints guest claims from an existing customers row', async () => {
    const { brandId } = await seedBrand('hook-guest');
    const { claims } = await createSignedInUser({
      before: async (userId) => {
        await sql(
          `insert into public.customers (brand_id, user_id, full_name) values ($1, $2, 'Guest')`,
          [brandId, userId],
        );
      },
    });
    assert.equal(claims.brand_id, brandId);
    assert.equal(claims.role, undefined, 'guests carry no role claim');
  });

  it('bootstraps a brand claim from user_metadata.brand_slug on first sign-in', async () => {
    const { brandId } = await seedBrand('hook-bootstrap');
    const { claims } = await createSignedInUser({
      userMetadata: { brand_slug: 'hook-bootstrap' },
    });
    assert.equal(claims.brand_id, brandId);
  });

  it('ignores an unknown brand_slug instead of failing token issuance', async () => {
    const { claims, accessToken } = await createSignedInUser({
      userMetadata: { brand_slug: 'no-such-brand-anywhere' },
    });
    assert.ok(accessToken, 'sign-in still succeeds');
    assert.equal(claims.brand_id, undefined);
  });
});
