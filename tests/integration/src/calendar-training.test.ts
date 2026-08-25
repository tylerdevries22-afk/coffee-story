import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';

import {
  createSignedInUser, seedBrand, skipUnlessConfigured, sql, userClient,
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
           (id, brand_id, release_id, brand_user_id, module_slug, lesson_slug,
            answers, score, passed, created_at)
         values ($1, $2, $3, $4, 'core', 'lesson', '[]', 0, false,
           now() - ($5::text || ' seconds')::interval)`,
        [randomUUID(), tenant.brandId, release.rows[0]!.id, staff.brandUserId, attempt * 11],
      );
    }
    await assert.rejects(
      sql(
        `insert into public.training_quiz_attempts
           (id, brand_id, release_id, brand_user_id, module_slug, lesson_slug,
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
         and routine_name in ('store_training_profile', 'publish_training_release')
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
  });
});
