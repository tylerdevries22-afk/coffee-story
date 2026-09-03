import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';

import {
  createSignedInUser, seedBrand, serviceClient, skipUnlessConfigured, sql, userClient,
} from './stack.ts';

async function staffFor(brandId: string, locationId: string) {
  let brandUserId = '';
  const session = await createSignedInUser({
    before: async (userId) => {
      const member = await sql<{ id: string }>(
        `insert into public.brand_users (user_id, brand_id, role, location_ids)
         values ($1, $2, 'staff', array[$3::uuid]) returning id`,
        [userId, brandId, locationId],
      );
      brandUserId = member.rows[0]!.id;
    },
  });
  return { ...session, brandUserId };
}

describe('calendar and training tenancy', { skip: skipUnlessConfigured }, () => {
  it('shows staff only calendar rows in their tenant and location', async () => {
    const own = await seedBrand('calendar-tenant-own');
    const foreign = await seedBrand('calendar-tenant-foreign');
    const staff = await staffFor(own.brandId, own.locationId);
    const category = await sql<{ id: string }>(
      `select id from public.calendar_categories where brand_id = $1 and slug = 'tasks'`,
      [own.brandId],
    );
    const foreignCategory = await sql<{ id: string }>(
      `select id from public.calendar_categories where brand_id = $1 and slug = 'tasks'`,
      [foreign.brandId],
    );
    const ownEntry = await sql<{ id: string }>(
      `insert into public.calendar_entries
         (brand_id, location_id, category_id, title, starts_at, ends_at, created_by)
       values ($1, $2, $3, 'Opening checklist', now(), now() + interval '1 hour', $4)
       returning id`,
      [own.brandId, own.locationId, category.rows[0]!.id, staff.brandUserId],
    );
    await sql(
      `insert into public.calendar_entries
         (brand_id, location_id, category_id, title, starts_at, ends_at)
       values ($1, $2, $3, 'Foreign task', now(), now() + interval '1 hour')`,
      [foreign.brandId, foreign.locationId, foreignCategory.rows[0]!.id],
    );

    const visible = await userClient(staff.accessToken).from('calendar_entries').select('id,title');
    assert.equal(visible.error, null);
    assert.deepEqual(visible.data, [{ id: ownEntry.rows[0]!.id, title: 'Opening checklist' }]);
  });

  it('serves published manifests without exposing answer keys', async () => {
    const tenant = await seedBrand('training-manifest');
    const staff = await staffFor(tenant.brandId, tenant.locationId);
    const runId = randomUUID();
    await sql(
      `insert into public.training_bootstrap_runs
         (id, brand_id, profile_fingerprint, pipeline_version, status)
       values ($1, $2, repeat('a', 64), 'test-v1', 'published')`,
      [runId, tenant.brandId],
    );
    await sql(
      `insert into public.training_releases
         (brand_id, bootstrap_run_id, version, status, manifest, answer_key, published_at)
       values ($1, $2, 1, 'published', '{"modules":[]}', '{"secret":true}', now())`,
      [tenant.brandId, runId],
    );

    const db = userClient(staff.accessToken);
    const release = await db.from('training_releases').select('brand_id,manifest').single();
    assert.equal(release.error, null);
    assert.equal(release.data?.brand_id, tenant.brandId);
    const secret = await db.from('training_releases').select('answer_key');
    assert.match(secret.error?.message ?? '', /permission denied/i);
  });

  it('enforces five quiz attempts and a ten-second retry window in Postgres', async () => {
    const tenant = await seedBrand('training-attempts');
    const staff = await staffFor(tenant.brandId, tenant.locationId);
    const runId = randomUUID();
    const release = await sql<{ id: string }>(
      `with run as (
         insert into public.training_bootstrap_runs
           (id, brand_id, profile_fingerprint, pipeline_version, status)
         values ($1, $2, repeat('b', 64), 'test-v1', 'published') returning id
       )
       insert into public.training_releases
         (brand_id, bootstrap_run_id, version, status, manifest, answer_key, published_at)
       select $2, id, 1, 'published', '{}', '{}', now() from run returning id`,
      [runId, tenant.brandId],
    );
    for (let attempt = 5; attempt >= 1; attempt -= 1) {
      await sql(
        `insert into public.training_quiz_attempts
           (id, brand_id, release_id, brand_user_id, track_slug, lesson_slug,
            answers, score, passed, created_at)
         values ($1, $2, $3, $4, 'core', 'lesson', '[]', 0, false,
           now() - ($5::text || ' seconds')::interval)`,
        [randomUUID(), tenant.brandId, release.rows[0]!.id, staff.brandUserId, attempt * 11],
      );
    }
    await assert.rejects(
      sql(
        `insert into public.training_quiz_attempts
           (id, brand_id, release_id, brand_user_id, track_slug, lesson_slug,
            answers, score, passed)
         values ($1, $2, $3, $4, 'core', 'lesson', '[]', 0, false)`,
        [randomUUID(), tenant.brandId, release.rows[0]!.id, staff.brandUserId],
      ),
      /training_attempt_limit_reached/,
    );
  });

  it('reserves profile storage and release publishing for the service role', async () => {
    const grants = await sql<{ routine_name: string; grantee: string }>(
      `select routine_name, grantee
       from information_schema.routine_privileges
       where routine_schema = 'public'
         and routine_name in ('store_training_profile', 'publish_training_release', 'publish_manual_training_release')
         and privilege_type = 'EXECUTE'
       order by routine_name, grantee`,
    );
    assert.ok(grants.rows.some((grant) => (
      grant.routine_name === 'publish_training_release' && grant.grantee === 'service_role'
    )));
    assert.ok(grants.rows.some((grant) => (
      grant.routine_name === 'store_training_profile' && grant.grantee === 'service_role'
    )));
    assert.ok(!grants.rows.some((grant) => ['anon', 'authenticated', 'PUBLIC'].includes(grant.grantee)));
    assert.ok(grants.rows.some((grant) => (
      grant.routine_name === 'publish_manual_training_release' && grant.grantee === 'service_role'
    )));
  });

  it('awards completed training competencies idempotently without crossing tenants', async () => {
    const tenant = await seedBrand('training-competency-award');
    const foreign = await seedBrand('training-competency-foreign');
    const staff = await staffFor(tenant.brandId, tenant.locationId);
    const foreignStaff = await staffFor(foreign.brandId, foreign.locationId);
    await sql(
      `insert into public.training_competencies (brand_id, competency_key, title)
       values ($1, 'equipment-safety', 'Equipment safety'),
              ($1, 'electrical-safety', 'Electrical safety'),
              ($1, 'not-in-lesson', 'Not in lesson'),
              ($2, 'equipment-safety', 'Equipment safety')`,
      [tenant.brandId, foreign.brandId],
    );
    const runId = randomUUID();
    await sql(
      `insert into public.training_bootstrap_runs
         (id, brand_id, profile_fingerprint, pipeline_version, status)
       values ($1, $2, repeat('d', 64), 'test-v1', 'published')`,
      [runId, tenant.brandId],
    );
    const release = await sql<{ id: string }>(
      `insert into public.training_releases
         (brand_id, bootstrap_run_id, version, status, manifest, answer_key, published_at)
       values ($1, $2, 1, 'published',
         '{"modules":[{"slug":"safety","lessons":[{"slug":"equipment-safety","grantsCompetencyKeys":["equipment-safety","electrical-safety"]}]}]}',
         '{}', now()) returning id`,
      [tenant.brandId, runId],
    );
    await sql(
      `insert into public.training_lesson_progress
         (brand_id, release_id, brand_user_id, track_slug, lesson_slug, status,
          score, attempt_count, completed_at)
       values ($1, $2, $3, 'safety', 'equipment-safety', 'completed', 100, 1, now())`,
      [tenant.brandId, release.rows[0]!.id, staff.brandUserId],
    );

    const actionId = randomUUID();
    const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1_000).toISOString();
    const args = {
      target_brand_user: staff.brandUserId,
      target_competency_key: 'equipment-safety',
      target_action_id: actionId,
      target_source: 'training',
      target_reason: '',
      target_expires_at: expiresAt,
      target_release: release.rows[0]!.id,
      target_track_slug: 'safety',
      target_lesson_slug: 'equipment-safety',
    };
    const first = await serviceClient().rpc('award_operation_competency', args);
    assert.equal(first.error, null, first.error?.message);
    const replay = await serviceClient().rpc('award_operation_competency', {
      ...args,
      target_expires_at: new Date(Date.now() + 366 * 24 * 60 * 60 * 1_000).toISOString(),
    });
    assert.equal(replay.error, null, replay.error?.message);
    assert.equal(replay.data?.id, first.data?.id);

    const renewed = await serviceClient().rpc('award_operation_competency', {
      ...args,
      target_action_id: randomUUID(),
    });
    assert.equal(renewed.error, null, renewed.error?.message);
    assert.notEqual(renewed.data?.id, first.data?.id);
    const awards = await sql<{ id: string; revoked_at: string | null }>(
      `select id, revoked_at from public.training_competency_awards
       where brand_id = $1 and brand_user_id = $2`,
      [tenant.brandId, staff.brandUserId],
    );
    assert.equal(awards.rows.length, 2);
    assert.ok(awards.rows.find((award) => award.id === first.data?.id)?.revoked_at);
    assert.equal(awards.rows.find((award) => award.id === renewed.data?.id)?.revoked_at, null);

    const browserAttempt = await userClient(staff.accessToken)
      .rpc('award_operation_competency', { ...args, target_action_id: randomUUID() });
    assert.match(browserAttempt.error?.message ?? '', /permission denied/i);
    const tenantMismatch = await serviceClient().rpc('award_operation_competency', {
      ...args,
      target_brand_user: foreignStaff.brandUserId,
      target_action_id: randomUUID(),
    });
    assert.equal(tenantMismatch.error?.message, 'training_competency_progress_invalid');

    const unrelated = await serviceClient().rpc('award_operation_competency', {
      ...args,
      target_competency_key: 'not-in-lesson',
      target_action_id: randomUUID(),
    });
    assert.equal(unrelated.error?.message, 'training_competency_progress_invalid');

    const collisionAction = randomUUID();
    const collisions = await Promise.all([
      serviceClient().rpc('award_operation_competency', {
        ...args,
        target_action_id: collisionAction,
      }),
      serviceClient().rpc('award_operation_competency', {
        ...args,
        target_action_id: collisionAction,
        target_competency_key: 'electrical-safety',
      }),
    ]);
    assert.equal(collisions.filter((result) => result.error === null).length, 1);
    assert.deepEqual(
      collisions.flatMap((result) => result.error ? [result.error.message] : []),
      ['operation_action_id_conflict'],
    );

    const grants = await sql<{ grantee: string }>(
      `select grantee from information_schema.routine_privileges
       where routine_schema = 'public'
         and routine_name = 'award_operation_competency'
         and privilege_type = 'EXECUTE'
         and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')`,
    );
    assert.deepEqual(grants.rows.map((row) => row.grantee), ['service_role']);
  });

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
      schemaVersion: 2,
      sources: [{}, {}, {}],
      modules: [
        { slug: 'knowledge', trackKey: 'knowledge' },
        { slug: 'skills', trackKey: 'skills' },
        { slug: 'service', trackKey: 'service' },
        { slug: 'safety', trackKey: 'safety' },
        { slug: 'operations', trackKey: 'operations' },
      ],
    };
    const draft = await sql<{ id: string; updated_at: string }>(
      `insert into public.training_releases
         (brand_id, version, status, manifest, answer_key, created_by, updated_by)
       values ($1, 2, 'draft', $2, '{"knowledge":{},"skills":{}}', $3, $3)
       returning id, updated_at`,
      [tenant.brandId, JSON.stringify(manifest), ownerMemberId],
    );

    const staleStartedAt = Date.now();
    const staleAttempt = await serviceClient().rpc('publish_manual_training_release', {
      target_brand: tenant.brandId,
      target_release: draft.rows[0]!.id,
      target_editor: ownerMemberId,
      expected_updated_at: new Date(new Date(draft.rows[0]!.updated_at).getTime() - 1_000).toISOString(),
    });
    assert.equal(staleAttempt.error?.message, 'training_draft_stale');
    assert.ok(Date.now() - staleStartedAt < 5_000, 'stale draft rejection must not be retried');

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

  it('keeps tenant-isolated menu and training media history in dedicated buckets', async () => {
    const tenant = await seedBrand('content-media-history');
    const foreign = await seedBrand('content-media-foreign');
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
    const outsider = await staffFor(foreign.brandId, foreign.locationId);
    const menu = await sql<{ id: string }>(
      `insert into public.menus (brand_id, name, is_published)
       values ($1, 'Menu', true) returning id`,
      [tenant.brandId],
    );
    const category = await sql<{ id: string }>(
      `insert into public.menu_categories (brand_id, menu_id, slug, title)
       values ($1, $2, 'coffee', 'Coffee') returning id`,
      [tenant.brandId, menu.rows[0]!.id],
    );
    const item = await sql<{ id: string }>(
      `insert into public.menu_items
         (brand_id, menu_id, category_id, slug, name, base_price_cents, image_url)
       values ($1, $2, $3, 'latte', 'Latte', 500, 'https://assets.example/latte-v1.webp')
       returning id`,
      [tenant.brandId, menu.rows[0]!.id, category.rows[0]!.id],
    );
    await sql(
      `update public.menu_items set image_url = 'https://assets.example/latte-v2.webp'
       where id = $1`,
      [item.rows[0]!.id],
    );
    await sql(
      `insert into public.training_releases
         (brand_id, version, status, manifest, answer_key, created_by, updated_by)
       values ($1, 1, 'draft', $2, '{}', $3, $3)`,
      [tenant.brandId, JSON.stringify({
        modules: [{
          slug: 'knowledge', icon: { url: 'https://assets.example/knowledge.webp' },
          lessons: [{ slug: 'coffee', media: [{ kind: 'video', title: 'Coffee', url: 'https://assets.example/coffee.mp4' }] }],
        }],
      }), ownerMemberId],
    );

    const history = await userClient(owner.accessToken).from('content_media_versions')
      .select('entity_type,entity_key,slot,public_url').order('created_at');
    assert.equal(history.error, null);
    assert.deepEqual(history.data?.map((entry) => entry.public_url).sort(), [
      'https://assets.example/coffee.mp4',
      'https://assets.example/knowledge.webp',
      'https://assets.example/latte-v1.webp',
      'https://assets.example/latte-v2.webp',
    ]);
    const leaked = await userClient(outsider.accessToken).from('content_media_versions').select('id');
    assert.deepEqual(leaked.data, []);
    const bucket = await sql<{ public: boolean; file_size_limit: number; allowed_mime_types: string[] }>(
      `select public, file_size_limit, allowed_mime_types
       from storage.buckets where id = 'training-media'`,
    );
    assert.equal(bucket.rows[0]!.public, true);
    assert.equal(Number(bucket.rows[0]!.file_size_limit), 10485760);
    assert.ok(bucket.rows[0]!.allowed_mime_types.includes('image/webp'));
    const mutationPolicies = await sql<{ policyname: string; using_expression: string | null }>(
      `select policyname, qual as using_expression
       from pg_policies
       where schemaname = 'storage' and tablename = 'objects'
         and policyname in ('storage_brand_update', 'storage_brand_delete')
       order by policyname`,
    );
    assert.equal(mutationPolicies.rows.length, 2);
    for (const policy of mutationPolicies.rows) {
      assert.match(policy.using_expression ?? '', /bucket_id = 'brand-assets'/);
      assert.doesNotMatch(policy.using_expression ?? '', /training-media|menu-images/);
    }
  });
});
