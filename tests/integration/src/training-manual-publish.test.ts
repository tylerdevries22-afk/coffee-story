import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';

import { createSignedInUser, seedBrand, serviceClient, skipUnlessConfigured, sql, userClient } from './stack.ts';

describe('training-manual-publish', { skip: skipUnlessConfigured }, () => {

  it('publishes an owner-authored draft atomically without exposing the function to browsers', async () => {
    const tenant = await seedBrand('training-owner-draft');
    let ownerMemberId = '';
    const owner = await createSignedInUser({
      before: async (userId) => {
        const member = await sql<{ id: string }>(
          `insert into public.brand_users (user_id, brand_id, role, location_ids)
           values ($1, $2, 'brand_owner', '{}') returning id`,
          [userId, tenant.brandId],
        );
        ownerMemberId = member.rows[0]!.id;
      },
    });
    const runId = randomUUID();
    await sql(
      `insert into public.training_bootstrap_runs
         (id, brand_id, profile_fingerprint, pipeline_version, status)
       values ($1, $2, repeat('c', 64), 'test-v1', 'published')`,
      [runId, tenant.brandId],
    );
    await sql(
      `insert into public.training_releases
         (brand_id, bootstrap_run_id, version, status, manifest, answer_key, published_at)
       values ($1, $2, 1, 'published', '{"sources":[],"modules":[]}', '{}', now())`,
      [tenant.brandId, runId],
    );
    const manifest = {
      schemaVersion: 3,
      sources: [{}, {}, {}],
      tracks: ['knowledge', 'skills', 'service', 'safety', 'operations'].map((slug) => ({ slug })),
    };
    const draft = await sql<{ id: string; updated_at: string }>(
      `insert into public.training_releases
         (brand_id, version, status, manifest, answer_key, created_by, updated_by)
       values ($1, 2, 'draft', $2, '{"knowledge":{},"skills":{}}', $3, $3)
       returning id, updated_at`,
      [tenant.brandId, JSON.stringify(manifest), ownerMemberId],
    );

    // Count the HTTP attempts rather than timing the round trip: a stale
    // rejection is a 4xx the harness answers once, and a wall-clock bound
    // read a slow runner as a retry (and would have let two fast retries
    // through).
    let attempts = 0;
    const counted = serviceClient((input, init) => {
      attempts += 1;
      return fetch(input, init);
    });
    const staleAttempt = await counted.rpc('publish_manual_training_release', {
      target_brand: tenant.brandId,
      target_release: draft.rows[0]!.id,
      target_editor: ownerMemberId,
      expected_updated_at: new Date(new Date(draft.rows[0]!.updated_at).getTime() - 1_000).toISOString(),
    });
    assert.equal(staleAttempt.error?.message, 'training_draft_stale');
    assert.equal(attempts, 1, 'a stale draft rejection is final and must not be retried');

    const browserAttempt = await userClient(owner.accessToken).rpc('publish_manual_training_release', {
      target_brand: tenant.brandId,
      target_release: draft.rows[0]!.id,
      target_editor: ownerMemberId,
      expected_updated_at: draft.rows[0]!.updated_at,
    });
    assert.match(browserAttempt.error?.message ?? '', /permission denied/i);

    const published = await serviceClient().rpc('publish_manual_training_release', {
      target_brand: tenant.brandId,
      target_release: draft.rows[0]!.id,
      target_editor: ownerMemberId,
      expected_updated_at: draft.rows[0]!.updated_at,
    });
    assert.equal(published.error, null);
    const releases = await sql<{ id: string; status: string; updated_by: string | null }>(
      `select id, status, updated_by from public.training_releases
       where brand_id = $1 order by version`,
      [tenant.brandId],
    );
    assert.deepEqual(releases.rows.map((release) => release.status), ['retired', 'published']);
    assert.equal(releases.rows[1]!.id, draft.rows[0]!.id);
    assert.equal(releases.rows[1]!.updated_by, ownerMemberId);
  });
});
