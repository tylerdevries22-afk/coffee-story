begin;
create extension if not exists pgtap with schema extensions;
set search_path = extensions, public, pg_catalog;
select plan(54);

select has_table(
  'public', 'tenant_package_publication_compensations',
  'publication compensation has an append-only audit table'
);
select has_column(
  'public', 'tenant_package_publication_events', 'previous_package_release_id',
  'publication events preserve their prior pointer'
);
select has_column(
  'public', 'tenant_package_publication_events', 'target_previous_status',
  'publication events preserve their target before-image'
);
select has_function(
  'public', 'compensate_tenant_package_publication',
  array[
    'uuid', 'uuid', 'text', 'text', 'text', 'text', 'text',
    'uuid', 'text', 'text', 'timestamp with time zone'
  ], 'the service compensation RPC exists'
);
select ok(not has_function_privilege(
  'anon',
  'public.compensate_tenant_package_publication(uuid,uuid,text,text,text,text,text,uuid,text,text,timestamp with time zone)',
  'EXECUTE'
), 'anonymous callers cannot compensate publication');
select ok(not has_function_privilege(
  'authenticated',
  'public.compensate_tenant_package_publication(uuid,uuid,text,text,text,text,text,uuid,text,text,timestamp with time zone)',
  'EXECUTE'
), 'authenticated callers cannot compensate publication');
select ok(has_function_privilege(
  'service_role',
  'public.compensate_tenant_package_publication(uuid,uuid,text,text,text,text,text,uuid,text,text,timestamp with time zone)',
  'EXECUTE'
), 'the service role can compensate publication');
select ok(not has_table_privilege(
  'service_role', 'public.tenant_package_publication_compensations',
  'INSERT,UPDATE,DELETE'
), 'the service role cannot mutate compensation evidence directly');

insert into public.brands (id, slug, name, status) values
  ('10000000-0000-4000-8000-000000000001', 'comp-first', 'Comp First', 'active'),
  ('10000000-0000-4000-8000-000000000002', 'comp-restore', 'Comp Restore', 'active'),
  ('10000000-0000-4000-8000-000000000003', 'comp-code', 'Comp Code', 'active'),
  ('10000000-0000-4000-8000-000000000004', 'comp-conflict', 'Comp Conflict', 'active'),
  ('10000000-0000-4000-8000-000000000005', 'comp-absent', 'Comp Absent', 'active'),
  ('10000000-0000-4000-8000-000000000006', 'comp-prior', 'Comp Prior', 'active');

insert into public.organization_readiness_checks (brand_id, check_key)
select brand.id, 'release_approval'
from public.brands brand where brand.slug like 'comp-%';

insert into public.tenant_package_releases (
  id, brand_id, release_key, artifact_digest, source_commit_sha,
  envelope_sha256, archive_sha256, archive_object_path, file_count, total_bytes
) values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
   'release-first', 'sha256:0101010101010101010101010101010101010101010101010101010101010101',
   '0101010101010101010101010101010101010101',
   'sha256:1101010101010101010101010101010101010101010101010101010101010101',
   'sha256:2101010101010101010101010101010101010101010101010101010101010101',
   '10000000-0000-4000-8000-000000000001/first/archive.zip', 1, 10),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002',
   'release-restore-a', 'sha256:0202020202020202020202020202020202020202020202020202020202020202',
   '0202020202020202020202020202020202020202',
   'sha256:1202020202020202020202020202020202020202020202020202020202020202',
   'sha256:2202020202020202020202020202020202020202020202020202020202020202',
   '10000000-0000-4000-8000-000000000002/a/archive.zip', 1, 10),
  ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002',
   'release-restore-b', 'sha256:0303030303030303030303030303030303030303030303030303030303030303',
   '0303030303030303030303030303030303030303',
   'sha256:1303030303030303030303030303030303030303030303030303030303030303',
   'sha256:2303030303030303030303030303030303030303030303030303030303030303',
   '10000000-0000-4000-8000-000000000002/b/archive.zip', 1, 10),
  ('20000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000003',
   'release-code-only', 'sha256:0404040404040404040404040404040404040404040404040404040404040404',
   '0404040404040404040404040404040404040404',
   'sha256:1404040404040404040404040404040404040404040404040404040404040404',
   'sha256:2404040404040404040404040404040404040404040404040404040404040404',
   '10000000-0000-4000-8000-000000000003/code/archive.zip', 1, 10),
  ('20000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000004',
   'release-conflict-a', 'sha256:0505050505050505050505050505050505050505050505050505050505050505',
   '0505050505050505050505050505050505050505',
   'sha256:1505050505050505050505050505050505050505050505050505050505050505',
   'sha256:2505050505050505050505050505050505050505050505050505050505050505',
   '10000000-0000-4000-8000-000000000004/a/archive.zip', 1, 10),
  ('20000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000004',
   'release-conflict-b', 'sha256:0606060606060606060606060606060606060606060606060606060606060606',
   '0606060606060606060606060606060606060606',
   'sha256:1606060606060606060606060606060606060606060606060606060606060606',
   'sha256:2606060606060606060606060606060606060606060606060606060606060606',
   '10000000-0000-4000-8000-000000000004/b/archive.zip', 1, 10),
  ('20000000-0000-4000-8000-000000000007', '10000000-0000-4000-8000-000000000004',
   'release-conflict-c', 'sha256:0707070707070707070707070707070707070707070707070707070707070707',
   '0707070707070707070707070707070707070707',
   'sha256:1707070707070707070707070707070707070707070707070707070707070707',
   'sha256:2707070707070707070707070707070707070707070707070707070707070707',
   '10000000-0000-4000-8000-000000000004/c/archive.zip', 1, 10),
  ('20000000-0000-4000-8000-000000000008', '10000000-0000-4000-8000-000000000006',
   'release-prior-a', 'sha256:0808080808080808080808080808080808080808080808080808080808080808',
   '0808080808080808080808080808080808080808',
   'sha256:1808080808080808080808080808080808080808080808080808080808080808',
   'sha256:2808080808080808080808080808080808080808080808080808080808080808',
   '10000000-0000-4000-8000-000000000006/a/archive.zip', 1, 10);

insert into storage.objects (id, bucket_id, name) values
  (gen_random_uuid(), 'tenant-packages',
   '10000000-0000-4000-8000-000000000002/a/archive.zip'),
  (gen_random_uuid(), 'tenant-packages',
   '10000000-0000-4000-8000-000000000004/a/archive.zip');

set local role service_role;

select is(public.publish_tenant_package(
  '10000000-0000-4000-8000-000000000001', 'release-first',
  'sha256:0101010101010101010101010101010101010101010101010101010101010101',
  '3101010101010101010101010101010101010101',
  'vercel:first-canary', 'github:first-approval'
), '20000000-0000-4000-8000-000000000001'::uuid,
  'a first publication succeeds');
select is((select previous_package_release_id
  from public.tenant_package_publication_events
  where brand_id = '10000000-0000-4000-8000-000000000001'), null::uuid,
  'a first publication snapshots an absent prior pointer');
select is((select target_previous_status
  from public.tenant_package_publication_events
  where brand_id = '10000000-0000-4000-8000-000000000001'), 'verified'::text,
  'the target verified state is captured before first publication');
select is(public.compensate_tenant_package_publication(
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  '3101010101010101010101010101010101010101',
  'vercel:first-canary', 'github:first-approval',
  'vercel:first-rollback', 'github:first-rollback',
  null, null, null, null
), 'compensated'::text, 'a first publication can be undone');
select is((select count(*) from public.tenant_package_publications
  where brand_id = '10000000-0000-4000-8000-000000000001'), 0::bigint,
  'undoing a first publication removes its pointer');
select is((select status from public.tenant_package_releases
  where id = '20000000-0000-4000-8000-000000000001'), 'verified'::text,
  'undoing a first publication restores the target state');
select is((select count(*) from public.tenant_package_publication_compensations
  where brand_id = '10000000-0000-4000-8000-000000000001'), 1::bigint,
  'first-publication compensation appends one audit row');
select is((select status from public.organization_readiness_checks
  where brand_id = '10000000-0000-4000-8000-000000000001'
    and check_key = 'release_approval'), 'failed'::text,
  'first-publication compensation fails release readiness');
select is(public.compensate_tenant_package_publication(
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  '3101010101010101010101010101010101010101',
  'vercel:first-canary', 'github:first-approval',
  'vercel:first-rollback', 'github:first-rollback',
  null, null, null, null
), 'compensated'::text, 'an exact compensation retry is idempotent');
select is((select count(*) from public.tenant_package_publication_compensations
  where brand_id = '10000000-0000-4000-8000-000000000001'), 1::bigint,
  'an idempotent retry does not duplicate compensation evidence');
select throws_ok($test$ select public.compensate_tenant_package_publication(
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  '3101010101010101010101010101010101010101',
  'vercel:first-canary', 'github:first-approval',
  'vercel:changed-rollback', 'github:changed-rollback',
  null, null, null, null
) $test$, '23514', 'tenant_package_compensation_conflict',
  'a retry cannot replace immutable rollback evidence');

select is(public.publish_tenant_package(
  '10000000-0000-4000-8000-000000000002', 'release-restore-a',
  'sha256:0202020202020202020202020202020202020202020202020202020202020202',
  '3202020202020202020202020202020202020202',
  'vercel:restore-a-canary', 'github:restore-a-approval'
), '20000000-0000-4000-8000-000000000002'::uuid,
  'the prior release publishes');
select set_config('test.restore_published_at', (select published_at::text
  from public.tenant_package_publications
  where brand_id = '10000000-0000-4000-8000-000000000002'), true);
select is(public.publish_tenant_package(
  '10000000-0000-4000-8000-000000000002', 'release-restore-b',
  'sha256:0303030303030303030303030303030303030303030303030303030303030303',
  '3303030303030303030303030303030303030303',
  'vercel:restore-b-canary', 'github:restore-b-approval'
), '20000000-0000-4000-8000-000000000003'::uuid,
  'a replacement release publishes');
select is((select previous_package_release_id
  from public.tenant_package_publication_events
  where brand_id = '10000000-0000-4000-8000-000000000002'
    and package_release_id = '20000000-0000-4000-8000-000000000003'),
  '20000000-0000-4000-8000-000000000002'::uuid,
  'replacement evidence snapshots the prior release');
select is((select previous_deployment_commit_sha
  from public.tenant_package_publication_events
  where brand_id = '10000000-0000-4000-8000-000000000002'
    and package_release_id = '20000000-0000-4000-8000-000000000003'),
  '3202020202020202020202020202020202020202'::text,
  'replacement evidence snapshots the prior commit');
select is((select target_previous_status
  from public.tenant_package_publication_events
  where brand_id = '10000000-0000-4000-8000-000000000002'
    and package_release_id = '20000000-0000-4000-8000-000000000003'),
  'verified'::text, 'replacement evidence snapshots the target state');
select is(public.compensate_tenant_package_publication(
  '10000000-0000-4000-8000-000000000002',
  '20000000-0000-4000-8000-000000000003',
  '3303030303030303030303030303030303030303',
  'vercel:restore-b-canary', 'github:restore-b-approval',
  'vercel:restore-b-rollback', 'github:restore-b-rollback',
  '20000000-0000-4000-8000-000000000002',
  'sha256:0202020202020202020202020202020202020202020202020202020202020202',
  '3202020202020202020202020202020202020202',
  current_setting('test.restore_published_at')::timestamptz
), 'compensated'::text, 'replacement publication is compensated');
select is((select current_release_id from public.tenant_package_publications
  where brand_id = '10000000-0000-4000-8000-000000000002'),
  '20000000-0000-4000-8000-000000000002'::uuid,
  'compensation restores the prior pointer');
select is((select published_at from public.tenant_package_publications
  where brand_id = '10000000-0000-4000-8000-000000000002'),
  current_setting('test.restore_published_at')::timestamptz,
  'compensation restores the exact prior publication timestamp');
select is((select status from public.tenant_package_releases
  where id = '20000000-0000-4000-8000-000000000002'), 'published'::text,
  'compensation republishes the prior release state');
select is((select status from public.tenant_package_releases
  where id = '20000000-0000-4000-8000-000000000003'), 'verified'::text,
  'compensation restores the replacement target before-image');
select is((select count(*) from public.tenant_package_releases
  where brand_id = '10000000-0000-4000-8000-000000000002'
    and status = 'published'), 1::bigint,
  'compensation preserves one published release');
select is((select rollback_approval_reference
  from public.tenant_package_publication_compensations
  where brand_id = '10000000-0000-4000-8000-000000000002'),
  'github:restore-b-rollback'::text, 'rollback evidence is append-only');
select is((select evidence->>'commitSha' from public.organization_readiness_checks
  where brand_id = '10000000-0000-4000-8000-000000000002'
    and check_key = 'release_approval'),
  '3202020202020202020202020202020202020202'::text,
  'restored readiness is bound to the prior commit');
select is(public.compensate_tenant_package_publication(
  '10000000-0000-4000-8000-000000000002',
  '20000000-0000-4000-8000-000000000003',
  '3303030303030303030303030303030303030303',
  'vercel:restore-b-canary', 'github:restore-b-approval',
  'vercel:restore-b-rollback', 'github:restore-b-rollback',
  '20000000-0000-4000-8000-000000000002',
  'sha256:0202020202020202020202020202020202020202020202020202020202020202',
  '3202020202020202020202020202020202020202',
  current_setting('test.restore_published_at')::timestamptz
), 'compensated'::text, 'restoring a prior release is retry-idempotent');

select is(public.publish_tenant_package(
  '10000000-0000-4000-8000-000000000003', 'release-code-only',
  'sha256:0404040404040404040404040404040404040404040404040404040404040404',
  '3404040404040404040404040404040404040404',
  'vercel:code-a-canary', 'github:code-a-approval'
), '20000000-0000-4000-8000-000000000004'::uuid,
  'the package for a code-only deployment publishes');
select set_config('test.code_published_at', (select published_at::text
  from public.tenant_package_publications
  where brand_id = '10000000-0000-4000-8000-000000000003'), true);
select is(public.publish_tenant_package(
  '10000000-0000-4000-8000-000000000003', 'release-code-only',
  'sha256:0404040404040404040404040404040404040404040404040404040404040404',
  '4404040404040404040404040404040404040404',
  'vercel:code-b-canary', 'github:code-b-approval'
), '20000000-0000-4000-8000-000000000004'::uuid,
  'the same package records a new deployment commit');
select is((select previous_package_release_id
  from public.tenant_package_publication_events
  where brand_id = '10000000-0000-4000-8000-000000000003'
    and deployment_commit_sha = '4404040404040404040404040404040404040404'),
  '20000000-0000-4000-8000-000000000004'::uuid,
  'code-only evidence snapshots the same release as prior');
select is(public.compensate_tenant_package_publication(
  '10000000-0000-4000-8000-000000000003',
  '20000000-0000-4000-8000-000000000004',
  '4404040404040404040404040404040404040404',
  'vercel:code-b-canary', 'github:code-b-approval',
  'vercel:code-b-rollback', 'github:code-b-rollback',
  '20000000-0000-4000-8000-000000000004',
  'sha256:0404040404040404040404040404040404040404040404040404040404040404',
  '3404040404040404040404040404040404040404',
  current_setting('test.code_published_at')::timestamptz
), 'compensated'::text, 'a code-only publication is compensated');
select is((select deployment_commit_sha from public.tenant_package_publications
  where brand_id = '10000000-0000-4000-8000-000000000003'),
  '3404040404040404040404040404040404040404'::text,
  'code-only compensation restores the prior pointer commit');
select is((select deployment_commit_sha from public.tenant_package_releases
  where id = '20000000-0000-4000-8000-000000000004'),
  '3404040404040404040404040404040404040404'::text,
  'code-only compensation restores the release commit');
select is((select published_at from public.tenant_package_releases
  where id = '20000000-0000-4000-8000-000000000004'),
  current_setting('test.code_published_at')::timestamptz,
  'code-only compensation restores the release timestamp');
select is((select status from public.tenant_package_releases
  where id = '20000000-0000-4000-8000-000000000004'), 'published'::text,
  'code-only compensation leaves the release published');

select is(public.publish_tenant_package(
  '10000000-0000-4000-8000-000000000004', 'release-conflict-a',
  'sha256:0505050505050505050505050505050505050505050505050505050505050505',
  '3505050505050505050505050505050505050505',
  'vercel:conflict-a-canary', 'github:conflict-a-approval'
), '20000000-0000-4000-8000-000000000005'::uuid,
  'the conflict baseline publishes');
select set_config('test.conflict_published_at', (select published_at::text
  from public.tenant_package_publications
  where brand_id = '10000000-0000-4000-8000-000000000004'), true);
select is(public.publish_tenant_package(
  '10000000-0000-4000-8000-000000000004', 'release-conflict-b',
  'sha256:0606060606060606060606060606060606060606060606060606060606060606',
  '3606060606060606060606060606060606060606',
  'vercel:conflict-b-canary', 'github:conflict-b-approval'
), '20000000-0000-4000-8000-000000000006'::uuid,
  'the candidate subject to compensation publishes');
select is(public.publish_tenant_package(
  '10000000-0000-4000-8000-000000000004', 'release-conflict-c',
  'sha256:0707070707070707070707070707070707070707070707070707070707070707',
  '3707070707070707070707070707070707070707',
  'vercel:conflict-c-canary', 'github:conflict-c-approval'
), '20000000-0000-4000-8000-000000000007'::uuid,
  'a newer publication wins the pointer');
select throws_ok($test$ select public.compensate_tenant_package_publication(
  '10000000-0000-4000-8000-000000000004',
  '20000000-0000-4000-8000-000000000006',
  '3606060606060606060606060606060606060606',
  'vercel:conflict-b-canary', 'github:conflict-b-approval',
  'vercel:conflict-b-rollback', 'github:conflict-b-rollback',
  '20000000-0000-4000-8000-000000000005',
  'sha256:0505050505050505050505050505050505050505050505050505050505050505',
  '3505050505050505050505050505050505050505',
  current_setting('test.conflict_published_at')::timestamptz
) $test$, '23514', 'tenant_package_compensation_conflict',
  'compensation refuses to overwrite a newer publication');
select is((select current_release_id from public.tenant_package_publications
  where brand_id = '10000000-0000-4000-8000-000000000004'),
  '20000000-0000-4000-8000-000000000007'::uuid,
  'a refused compensation leaves the newer pointer intact');
select is((select count(*) from public.tenant_package_publication_compensations
  where failed_release_id = '20000000-0000-4000-8000-000000000006'), 0::bigint,
  'a refused compensation does not write audit evidence');

select is(public.compensate_tenant_package_publication(
  '10000000-0000-4000-8000-000000000005',
  '20000000-0000-4000-8000-000000000099',
  '3999999999999999999999999999999999999999',
  'vercel:absent-canary', 'github:absent-approval',
  'vercel:absent-rollback', 'github:absent-rollback',
  null, null, null, null
), 'not_committed'::text,
  'an absent exact event and unchanged empty pointer is safe to report');
select is(public.publish_tenant_package(
  '10000000-0000-4000-8000-000000000006', 'release-prior-a',
  'sha256:0808080808080808080808080808080808080808080808080808080808080808',
  '3808080808080808080808080808080808080808',
  'vercel:prior-canary', 'github:prior-approval'
), '20000000-0000-4000-8000-000000000008'::uuid,
  'a nonempty not-committed baseline publishes');
select set_config('test.prior_published_at', (select published_at::text
  from public.tenant_package_publications
  where brand_id = '10000000-0000-4000-8000-000000000006'), true);
select is(public.compensate_tenant_package_publication(
  '10000000-0000-4000-8000-000000000006',
  '20000000-0000-4000-8000-000000000098',
  '3899999999999999999999999999999999999999',
  'vercel:missing-canary', 'github:missing-approval',
  'vercel:missing-rollback', 'github:missing-rollback',
  '20000000-0000-4000-8000-000000000008',
  'sha256:0808080808080808080808080808080808080808080808080808080808080808',
  '3808080808080808080808080808080808080808',
  current_setting('test.prior_published_at')::timestamptz
), 'not_committed'::text,
  'an absent exact event requires the unchanged preflight pointer');
select throws_ok($test$ select public.compensate_tenant_package_publication(
  '10000000-0000-4000-8000-000000000006',
  '20000000-0000-4000-8000-000000000008',
  '3808080808080808080808080808080808080808',
  'vercel:prior-canary', 'github:prior-approval',
  'vercel:wrong-rollback', 'github:wrong-rollback',
  null, null, null, null
) $test$, '23514', 'tenant_package_compensation_conflict',
  'caller prior evidence must match the immutable event snapshot');

reset role;
select throws_ok($test$ update public.tenant_package_publication_compensations
  set rollback_approval_reference = 'github:changed'
  where brand_id = '10000000-0000-4000-8000-000000000002' $test$,
  '42501', 'tenant_package_event_immutable',
  'compensation audit evidence cannot be updated');
select throws_ok($test$ delete from public.tenant_package_publication_events
  where brand_id = '10000000-0000-4000-8000-000000000002' $test$,
  '42501', 'tenant_package_event_immutable',
  'publication snapshots cannot be deleted');
select lives_ok(
  'select app.assert_tenant_package_publication_compensation()',
  'release readiness verifies the compensation contract'
);

select * from finish();
rollback;
