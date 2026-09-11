begin;
create extension if not exists pgtap with schema extensions;
set search_path = extensions, public, pg_catalog;
select plan(24);

select has_table('app_private', 'tenant_package_upload_sessions',
  'upload sessions are durable and private');
select has_index('app_private', 'tenant_package_upload_sessions',
  'tenant_package_upload_sessions_staged_release_idx',
  'the staged release foreign key has a child-leading index');
select has_function('public', 'begin_tenant_package_upload',
  array['uuid','text','text','text','text','text','text','integer','bigint'],
  'uploads begin at a database fence');
select has_function('public', 'renew_tenant_package_upload', array['uuid'],
  'long uploads renew their mutation lease');
select has_function('public', 'stage_tenant_package',
  array['uuid','text','text','text','text','text','text','integer','bigint','jsonb','uuid'],
  'staging consumes an upload session');
select ok(has_function_privilege('service_role',
  'public.begin_tenant_package_upload(uuid,text,text,text,text,text,text,integer,bigint)',
  'EXECUTE'), 'service credentials can begin an upload');
select ok(not has_function_privilege('authenticated',
  'public.begin_tenant_package_upload(uuid,text,text,text,text,text,text,integer,bigint)',
  'EXECUTE'), 'authenticated clients cannot begin an upload');
select ok(not app_private.is_deletable_tenant_package_object(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/' || repeat('a', 64) || '/files/a/../b',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/' || repeat('a', 64)),
  'cleanup rejects traversal below a canonical kind');
select ok(not app_private.is_deletable_tenant_package_object(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/' || repeat('a', 64) || '/files/a'
    || chr(92) || 'b',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/' || repeat('a', 64)),
  'cleanup rejects a single backslash');
select ok(not app_private.is_deletable_tenant_package_object(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/' || repeat('a', 64) || '/files/a'
    || chr(1) || 'b',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/' || repeat('a', 64)),
  'cleanup rejects control bytes');
select ok(not app_private.is_deletable_tenant_package_object(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/' || repeat('a', 64) || '/files/'
    || repeat('é', 700),
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/' || repeat('a', 64)),
  'cleanup enforces the same UTF-8 byte boundary as the runner');
select ok(not app_private.is_deletable_tenant_package_object(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/' || repeat('a', 64) || '/files/a//b',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/' || repeat('a', 64)),
  'cleanup rejects empty tail components');

insert into public.brands (id, slug, name, status) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'upload-session', 'Upload Session', 'active');
insert into public.organization_readiness_checks (brand_id, check_key) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'tenant_artifacts');

set local role service_role;
select set_config('test.upload_id', public.begin_tenant_package_upload(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'upload-2026.09.08',
  'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
  'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
  1, 10
)::text, true);
select is(public.begin_tenant_package_upload(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'upload-2026.09.08',
  'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
  'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
  1, 10
), current_setting('test.upload_id')::uuid, 'an exact begin retry reuses its session');
select throws_ok($test$ select public.begin_tenant_package_upload(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'upload-2026.09.08',
  'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
  'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
  1, 10
) $test$, '23505', 'tenant_package_upload_conflict',
  'a release key cannot switch its immutable namespace');
reset role;

insert into storage.objects (id, bucket_id, name) values
  (gen_random_uuid(), 'tenant-packages',
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc/archive.zip'),
  (gen_random_uuid(), 'tenant-packages',
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc/files/brand.json');
update app_private.tenant_package_upload_sessions set expires_at = now() - interval '1 second'
where id = current_setting('test.upload_id')::uuid;
set local role service_role;
create temp table cleanup_batch as
  select * from public.claim_tenant_package_cleanup_candidates(500);
select is((select count(*) from cleanup_batch), 2::bigint,
  'expired sessions return their bounded canonical objects');
select is((select min(reason) from cleanup_batch), 'upload_expired'::text,
  'expired upload cleanup is classified');
select set_config('test.claim_id', (select claim_id::text from cleanup_batch limit 1), true);
select throws_ok(format($test$ select public.renew_tenant_package_upload(%L) $test$,
  current_setting('test.upload_id')), '23514', 'tenant_package_upload_closed',
  'a cleanup claim fences later upload mutations');
select throws_ok($test$ select public.begin_tenant_package_upload(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'same-prefix-new-key',
  'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
  'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
  1, 10
) $test$, '23514', 'tenant_package_upload_closed',
  'a different release key cannot revive a namespace after cleanup starts');
reset role;
delete from storage.objects object_row using cleanup_batch batch
where batch.object_path is not null and object_row.name = batch.object_path
  and object_row.name like '%/archive.zip';
set local role service_role;
select is(public.confirm_tenant_package_purge_claim(
  current_setting('test.claim_id')::uuid), false,
  'confirmation requeues a partially drained namespace');
reset role;
select is((select objects_purged_at from app_private.tenant_package_upload_sessions
  where id = current_setting('test.upload_id')::uuid), null::timestamptz,
  'partial deletion is never recorded as purged');
set local role service_role;
select throws_ok($test$ select public.begin_tenant_package_upload(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'partial-prefix-new-key',
  'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
  'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
  1, 10
) $test$, '23514', 'tenant_package_upload_closed',
  'partial cleanup permanently fences namespace reuse');
truncate cleanup_batch;
insert into cleanup_batch select * from public.claim_tenant_package_cleanup_candidates(500);
select is((select count(*) from cleanup_batch), 1::bigint,
  'the next claim resumes at the remaining object');
select set_config('test.claim_id', (select claim_id::text from cleanup_batch limit 1), true);
reset role;
delete from storage.objects object_row using cleanup_batch batch
where object_row.name = batch.object_path;
set local role service_role;
select is(public.confirm_tenant_package_purge_claim(
  current_setting('test.claim_id')::uuid), true,
  'an empty namespace can be confirmed');
reset role;
select is((select status from app_private.tenant_package_upload_sessions
  where id = current_setting('test.upload_id')::uuid), 'purged'::text,
  'confirmed upload cleanup closes the session permanently');

select * from finish();
rollback;
