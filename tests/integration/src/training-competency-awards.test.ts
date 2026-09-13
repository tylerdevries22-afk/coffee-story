import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';

import { staffFor } from './calendar-training-fixtures.ts';
import { seedBrand, serviceClient, skipUnlessConfigured, sql, userClient } from './stack.ts';

describe('training-competency-awards', { skip: skipUnlessConfigured }, () => {

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
         '{"tracks":[{"slug":"safety","lessons":[{"slug":"equipment-safety","grantsCompetencyKeys":["equipment-safety","electrical-safety"]}]}]}',
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
});
