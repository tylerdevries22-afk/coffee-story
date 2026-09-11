begin;
create extension if not exists pgtap with schema extensions;
set search_path = extensions, public, pg_catalog;
select plan(14);

insert into public.brands (id, slug, name, status) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'upload-session', 'Upload Session', 'active');
insert into public.organization_readiness_checks (brand_id, check_key) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'tenant_artifacts');
create temp table cleanup_batch (
  object_path text, target_id uuid, claim_id uuid, reason text
);
grant select, insert, update, delete, truncate on cleanup_batch to service_role;

insert into public.tenant_package_releases (
  id, brand_id, release_key, artifact_digest, source_commit_sha, envelope_sha256,
  archive_sha256, archive_object_path, file_count, total_bytes, status,
  object_retention_until, superseded_at
) values (
  '018f0f10-0000-7000-8000-000000000019',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'malformed-2026.09.08',
  'sha256:9191919191919191919191919191919191919191919191919191919191919191',
  '9292929292929292929292929292929292929292',
  'sha256:9393939393939393939393939393939393939393939393939393939393939393',
  'sha256:9494949494949494949494949494949494949494949494949494949494949494',
  'malformed/archive-object', 1, 10, 'superseded', now() - interval '3 hours',
  now() - interval '3 hours'
);

insert into public.tenant_package_releases (
  id, brand_id, release_key, artifact_digest, source_commit_sha, envelope_sha256,
  archive_sha256, archive_object_path, file_count, total_bytes, status,
  object_retention_until, superseded_at
) values (
  '018f0f10-0000-7000-8000-000000000020',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'legacy-2026.09.08',
  'sha256:abababababababababababababababababababababababababababababababab',
  'cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd',
  'sha256:efefefefefefefefefefefefefefefefefefefefefefefefefefefefefefefef',
  'sha256:1212121212121212121212121212121212121212121212121212121212121212',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/abababababababababababababababababababababababababababababababab/archive.zip',
  1, 10, 'superseded', now() - interval '1 hour', now() - interval '1 hour'
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
reset role;
set local session_replication_role = replica;
delete from storage.objects object_row using cleanup_batch batch
where object_row.name = batch.object_path;
set local role service_role;
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
set local role service_role;
truncate cleanup_batch;
insert into cleanup_batch select * from public.claim_tenant_package_cleanup_candidates(500);
select ok((select reason = 'cleanup_blocked'
    and target_id = '018f0f10-0000-7000-8000-000000000019'::uuid
    from cleanup_batch limit 1),
  'malformed release evidence is fenced after valid work without starvation');
select set_config('test.claim_id', (select claim_id::text from cleanup_batch limit 1), true);
select is(public.confirm_tenant_package_purge_claim(
  current_setting('test.claim_id')::uuid), false,
  'malformed evidence confirmation replays a durable blocked result');
reset role;
select ok((select purge_blocked_at is not null
  from public.tenant_package_releases
  where id = '018f0f10-0000-7000-8000-000000000019'),
  'malformed evidence is quarantined under the brand-first lock order');

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
select throws_ok($test$ select public.begin_tenant_package_upload(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'blocked-prefix-new-key',
  'sha256:1313131313131313131313131313131313131313131313131313131313131313',
  '1414141414141414141414141414141414141414',
  'sha256:1515151515151515151515151515151515151515151515151515151515151515',
  'sha256:1616161616161616161616161616161616161616161616161616161616161616',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/1313131313131313131313131313131313131313131313131313131313131313/1515151515151515151515151515151515151515151515151515151515151515',
  1, 10
) $test$, '23514', 'tenant_package_upload_closed',
  'blocked cleanup permanently fences namespace reuse');
truncate cleanup_batch;
insert into cleanup_batch select * from public.claim_tenant_package_cleanup_candidates(500);
select is((select target_id from cleanup_batch limit 1),
  '018f0f10-0000-7000-8000-000000000031'::uuid,
  'blocked oldest work does not starve a later candidate');
select set_config('test.claim_id', (select claim_id::text from cleanup_batch limit 1), true);
reset role;
set local session_replication_role = replica;
delete from storage.objects object_row using cleanup_batch batch
where object_row.name = batch.object_path;
set local role service_role;
select is(public.confirm_tenant_package_purge_claim(
  current_setting('test.claim_id')::uuid), true, 'later cleanup still drains normally');
reset role;

select * from finish();
rollback;
