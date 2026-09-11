begin;
create extension if not exists pgtap with schema extensions;
set search_path = extensions, public, pg_catalog;
select plan(10);

insert into public.brands (id, slug, name, status) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'upload-session', 'Upload Session', 'active');
insert into public.organization_readiness_checks (brand_id, check_key) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'tenant_artifacts');
create temp table cleanup_batch (
  object_path text, target_id uuid, claim_id uuid, reason text
);
grant select, insert, update, delete, truncate on cleanup_batch to service_role;

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
reset role;
set local session_replication_role = replica;
delete from storage.objects object_row using cleanup_batch batch
where object_row.name = batch.object_path;
set local role service_role;
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
reset role;
set local session_replication_role = replica;
delete from storage.objects object_row using cleanup_batch batch
where object_row.name = batch.object_path;
set local role service_role;
select is(public.confirm_tenant_package_purge_claim(
  current_setting('test.claim_id')::uuid), false,
  'the first large batch is requeued while one object remains');
truncate cleanup_batch;
insert into cleanup_batch select * from public.claim_tenant_package_cleanup_candidates(500);
select is((select count(*) from cleanup_batch), 1::bigint,
  'the second claim exposes the remainder beyond 500');
select set_config('test.claim_id', (select claim_id::text from cleanup_batch limit 1), true);
reset role;
set local session_replication_role = replica;
delete from storage.objects object_row using cleanup_batch batch
where object_row.name = batch.object_path;
set local role service_role;
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

select * from finish();
rollback;
