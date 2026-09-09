begin;
create extension if not exists pgtap with schema extensions;
set search_path = extensions, public, pg_catalog;
select plan(43);

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
delete from storage.objects object_row using cleanup_batch batch
where batch.object_path is not null and object_row.name = batch.object_path
  and object_row.name like '%/archive.zip';
select is(public.confirm_tenant_package_purge_claim(
  current_setting('test.claim_id')::uuid), false,
  'confirmation requeues a partially drained namespace');
reset role;
select is((select objects_purged_at from app_private.tenant_package_upload_sessions
  where id = current_setting('test.upload_id')::uuid), null::timestamptz,
  'partial deletion is never recorded as purged');
set local role service_role;
truncate cleanup_batch;
insert into cleanup_batch select * from public.claim_tenant_package_cleanup_candidates(500);
select is((select count(*) from cleanup_batch), 1::bigint,
  'the next claim resumes at the remaining object');
select set_config('test.claim_id', (select claim_id::text from cleanup_batch limit 1), true);
delete from storage.objects object_row using cleanup_batch batch
where object_row.name = batch.object_path;
select is(public.confirm_tenant_package_purge_claim(
  current_setting('test.claim_id')::uuid), true,
  'an empty namespace can be confirmed');
reset role;
select is((select status from app_private.tenant_package_upload_sessions
  where id = current_setting('test.upload_id')::uuid), 'purged'::text,
  'confirmed upload cleanup closes the session permanently');

insert into public.tenant_package_releases (
  id, brand_id, release_key, artifact_digest, source_commit_sha,
  envelope_sha256, archive_sha256, archive_object_path, file_count,
  total_bytes, verified_at
) values (
  '018f0f10-0000-7000-8000-000000000010',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'stale-2026.09.08',
  'sha256:1111111111111111111111111111111111111111111111111111111111111111',
  '2222222222222222222222222222222222222222',
  'sha256:3333333333333333333333333333333333333333333333333333333333333333',
  'sha256:4444444444444444444444444444444444444444444444444444444444444444',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/1111111111111111111111111111111111111111111111111111111111111111/3333333333333333333333333333333333333333333333333333333333333333/archive.zip',
  1, 10, now() - interval '25 hours'
);
insert into public.tenant_package_files (
  brand_id, package_release_id, relative_path, path_key, content_sha256,
  mime_type, byte_size, preview_kind, object_path
) values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '018f0f10-0000-7000-8000-000000000010', 'brand.json', 'brand.json',
  'sha256:5555555555555555555555555555555555555555555555555555555555555555',
  'application/json', 10, 'text',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/1111111111111111111111111111111111111111111111111111111111111111/3333333333333333333333333333333333333333333333333333333333333333/files/brand.json'
);
insert into storage.objects (id, bucket_id, name) values
  (gen_random_uuid(), 'tenant-packages',
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/1111111111111111111111111111111111111111111111111111111111111111/3333333333333333333333333333333333333333333333333333333333333333/archive.zip'),
  (gen_random_uuid(), 'tenant-packages',
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/1111111111111111111111111111111111111111111111111111111111111111/3333333333333333333333333333333333333333333333333333333333333333/files/brand.json');
set local role service_role;
truncate cleanup_batch;
insert into cleanup_batch select * from public.claim_tenant_package_cleanup_candidates(500);
select is((select min(reason) from cleanup_batch), 'stale_verified'::text,
  'unpublished verified releases become cleanup candidates after 24 hours');
select is((select status from public.tenant_package_releases
  where id = '018f0f10-0000-7000-8000-000000000010'), 'failed'::text,
  'claiming stale evidence prevents a concurrent publish');
select throws_ok($test$ select public.publish_tenant_package(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'stale-2026.09.08',
  'sha256:1111111111111111111111111111111111111111111111111111111111111111',
  '2222222222222222222222222222222222222222',
  'vercel:stale-canary', 'github:stale-approval'
) $test$, '23514', 'tenant_package_release_mismatch',
  'a stale cleanup claim cannot race publication');
select set_config('test.claim_id', (select claim_id::text from cleanup_batch limit 1), true);
delete from storage.objects object_row using cleanup_batch batch
where object_row.name = batch.object_path;
select is(public.confirm_tenant_package_purge_claim(
  current_setting('test.claim_id')::uuid), true,
  'stale verified evidence is purged only after its namespace is empty');
reset role;

select set_config('test.large_upload_id', public.begin_tenant_package_upload(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'large-2026.09.08',
  'sha256:6666666666666666666666666666666666666666666666666666666666666666',
  '7777777777777777777777777777777777777777',
  'sha256:8888888888888888888888888888888888888888888888888888888888888888',
  'sha256:9999999999999999999999999999999999999999999999999999999999999999',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/6666666666666666666666666666666666666666666666666666666666666666/8888888888888888888888888888888888888888888888888888888888888888',
  501, 501
)::text, true);
reset role;
insert into storage.objects (id, bucket_id, name)
select gen_random_uuid(), 'tenant-packages',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/6666666666666666666666666666666666666666666666666666666666666666/8888888888888888888888888888888888888888888888888888888888888888/files/' || value
from generate_series(1, 501) value;
update app_private.tenant_package_upload_sessions set expires_at = now() - interval '1 second'
where id = current_setting('test.large_upload_id')::uuid;
set local role service_role;
truncate cleanup_batch;
insert into cleanup_batch select * from public.claim_tenant_package_cleanup_candidates(500);
select is((select count(*) from cleanup_batch), 500::bigint,
  'one database claim never exceeds 500 objects');
select set_config('test.claim_id', (select claim_id::text from cleanup_batch limit 1), true);
delete from storage.objects object_row using cleanup_batch batch
where object_row.name = batch.object_path;
select is(public.confirm_tenant_package_purge_claim(
  current_setting('test.claim_id')::uuid), false,
  'the first large batch is requeued while one object remains');
truncate cleanup_batch;
insert into cleanup_batch select * from public.claim_tenant_package_cleanup_candidates(500);
select is((select count(*) from cleanup_batch), 1::bigint,
  'the second claim exposes the remainder beyond 500');
select set_config('test.claim_id', (select claim_id::text from cleanup_batch limit 1), true);
delete from storage.objects object_row using cleanup_batch batch
where object_row.name = batch.object_path;
select is(public.confirm_tenant_package_purge_claim(
  current_setting('test.claim_id')::uuid), true,
  'the final large batch confirms after every object is gone');
select is(public.confirm_tenant_package_purge_claim(
  current_setting('test.claim_id')::uuid), true,
  'a committed successful confirmation is retry-idempotent');
reset role;
select is((select status from app_private.tenant_package_upload_sessions
  where id = current_setting('test.large_upload_id')::uuid), 'purged'::text,
  'large upload cleanup reaches a terminal purged state');

insert into public.tenant_package_releases (
  id, brand_id, release_key, artifact_digest, source_commit_sha, envelope_sha256,
  archive_sha256, archive_object_path, file_count, total_bytes, status,
  object_retention_until
) values (
  '018f0f10-0000-7000-8000-000000000020',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'legacy-2026.09.08',
  'sha256:abababababababababababababababababababababababababababababababab',
  'cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd',
  'sha256:efefefefefefefefefefefefefefefefefefefefefefefefefefefefefefefef',
  'sha256:1212121212121212121212121212121212121212121212121212121212121212',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/abababababababababababababababababababababababababababababababab/archive.zip',
  1, 10, 'superseded', now() - interval '1 hour'
);
insert into storage.objects (bucket_id, name) values (
  'tenant-packages',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/abababababababababababababababababababababababababababababababab/archive.zip'
), (
  'tenant-packages',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/abababababababababababababababababababababababababababababababab/efefefefefefefefefefefefefefefefefefefefefefefefefefefefefefefef/archive.zip'
);
set local role service_role;
truncate cleanup_batch;
insert into cleanup_batch select * from public.claim_tenant_package_cleanup_candidates(500);
select is((select object_path from cleanup_batch limit 1),
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/abababababababababababababababababababababababababababababababab/archive.zip'::text,
  'legacy releases retain their actual two-segment namespace');
select set_config('test.claim_id', (select claim_id::text from cleanup_batch limit 1), true);
delete from storage.objects object_row using cleanup_batch batch
where object_row.name = batch.object_path;
select is(public.confirm_tenant_package_purge_claim(
  current_setting('test.claim_id')::uuid), true,
  'legacy namespace confirmation waits for its actual objects');
select is(public.confirm_tenant_package_purge_claim(
  current_setting('test.claim_id')::uuid), true,
  'legacy confirmation safely replays after a lost response');
reset role;
select ok(exists (
  select 1 from storage.objects object_row
  where object_row.name =
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/abababababababababababababababababababababababababababababababab/efefefefefefefefefefefefefefefefefefefefefefefefefefefefefefefef/archive.zip'
), 'legacy cleanup leaves a coexisting modern namespace untouched');

insert into app_private.tenant_package_upload_sessions (
  id, brand_id, release_key, artifact_digest, source_commit_sha, envelope_sha256,
  archive_sha256, object_prefix, file_count, total_bytes, expires_at
) values
  ('018f0f10-0000-7000-8000-000000000030',
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'blocked-2026.09.08',
   'sha256:1313131313131313131313131313131313131313131313131313131313131313',
   '1414141414141414141414141414141414141414',
   'sha256:1515151515151515151515151515151515151515151515151515151515151515',
   'sha256:1616161616161616161616161616161616161616161616161616161616161616',
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/1313131313131313131313131313131313131313131313131313131313131313/1515151515151515151515151515151515151515151515151515151515151515',
   1, 10, now() - interval '2 hours'),
  ('018f0f10-0000-7000-8000-000000000031',
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'later-2026.09.08',
   'sha256:1717171717171717171717171717171717171717171717171717171717171717',
   '1818181818181818181818181818181818181818',
   'sha256:1919191919191919191919191919191919191919191919191919191919191919',
   'sha256:2020202020202020202020202020202020202020202020202020202020202020',
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/1717171717171717171717171717171717171717171717171717171717171717/1919191919191919191919191919191919191919191919191919191919191919',
   1, 10, now() - interval '1 hour');
insert into storage.objects (bucket_id, name) values
  ('tenant-packages',
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/1313131313131313131313131313131313131313131313131313131313131313/1515151515151515151515151515151515151515151515151515151515151515/unexpected.bin'),
  ('tenant-packages',
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/1717171717171717171717171717171717171717171717171717171717171717/1919191919191919191919191919191919191919191919191919191919191919/archive.zip');
set local role service_role;
truncate cleanup_batch;
insert into cleanup_batch select * from public.claim_tenant_package_cleanup_candidates(500);
select is((select reason from cleanup_batch limit 1), 'cleanup_blocked'::text,
  'an unexpected namespace object produces a terminal blocked claim');
select set_config('test.claim_id', (select claim_id::text from cleanup_batch limit 1), true);
select is(public.confirm_tenant_package_purge_claim(
  current_setting('test.claim_id')::uuid), false, 'blocked confirmation never marks objects purged');
select is(public.confirm_tenant_package_purge_claim(
  current_setting('test.claim_id')::uuid), false, 'blocked confirmation retry replays false');
reset role;
select ok((select purge_blocked_at is not null and objects_purged_at is null
  from app_private.tenant_package_upload_sessions
  where id = '018f0f10-0000-7000-8000-000000000030'),
  'a blocked namespace records operator-visible state without claiming deletion');
set local role service_role;
truncate cleanup_batch;
insert into cleanup_batch select * from public.claim_tenant_package_cleanup_candidates(500);
select is((select target_id from cleanup_batch limit 1),
  '018f0f10-0000-7000-8000-000000000031'::uuid,
  'blocked oldest work does not starve a later candidate');
select set_config('test.claim_id', (select claim_id::text from cleanup_batch limit 1), true);
delete from storage.objects object_row using cleanup_batch batch
where object_row.name = batch.object_path;
select is(public.confirm_tenant_package_purge_claim(
  current_setting('test.claim_id')::uuid), true, 'later cleanup still drains normally');

select * from finish();
rollback;
