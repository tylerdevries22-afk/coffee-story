begin;
create extension if not exists pgtap with schema extensions;
set search_path = extensions, public, pg_catalog;
select plan(6);

insert into public.brands (id, slug, name, status) values
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'stage-replay', 'Stage Replay', 'active');
insert into public.organization_readiness_checks (brand_id, check_key) values
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'tenant_artifacts');
select set_config('test.prefix',
  'dddddddd-dddd-dddd-dddd-dddddddddddd/' || repeat('a', 64) || '/' || repeat('b', 64), true);
insert into storage.objects (id, bucket_id, name) values
  (gen_random_uuid(), 'tenant-packages', current_setting('test.prefix') || '/archive.zip'),
  (gen_random_uuid(), 'tenant-packages', current_setting('test.prefix') || '/files/brand.json');
set local role service_role;
select set_config('test.upload_id', public.begin_tenant_package_upload(
  'dddddddd-dddd-dddd-dddd-dddddddddddd', 'replay-2026.09.08',
  'sha256:' || repeat('a', 64), repeat('c', 40),
  'sha256:' || repeat('b', 64), 'sha256:' || repeat('d', 64),
  current_setting('test.prefix'), 1, 10
)::text, true);
select set_config('test.release_id', public.stage_tenant_package(
  'dddddddd-dddd-dddd-dddd-dddddddddddd', 'replay-2026.09.08',
  'sha256:' || repeat('a', 64), repeat('c', 40),
  'sha256:' || repeat('b', 64), 'sha256:' || repeat('d', 64),
  current_setting('test.prefix') || '/archive.zip', 1, 10,
  jsonb_build_array(jsonb_build_object(
    'relativePath', 'brand.json', 'pathKey', 'brand.json',
    'contentSha256', 'sha256:' || repeat('e', 64), 'mimeType', 'application/json',
    'byteSize', 10, 'previewKind', 'text',
    'objectPath', current_setting('test.prefix') || '/files/brand.json')),
  current_setting('test.upload_id')::uuid
)::text, true);
select is(public.stage_tenant_package(
  'dddddddd-dddd-dddd-dddd-dddddddddddd', 'replay-2026.09.08',
  'sha256:' || repeat('a', 64), repeat('c', 40),
  'sha256:' || repeat('b', 64), 'sha256:' || repeat('d', 64),
  current_setting('test.prefix') || '/archive.zip', 1, 10,
  jsonb_build_array(jsonb_build_object(
    'relativePath', 'brand.json', 'pathKey', 'brand.json',
    'contentSha256', 'sha256:' || repeat('e', 64), 'mimeType', 'application/json',
    'byteSize', 10, 'previewKind', 'text',
    'objectPath', current_setting('test.prefix') || '/files/brand.json')),
  current_setting('test.upload_id')::uuid
), current_setting('test.release_id')::uuid, 'an exact lost-response retry is idempotent');
select throws_ok($test$ select public.stage_tenant_package(
  'dddddddd-dddd-dddd-dddd-dddddddddddd', 'replay-2026.09.08',
  'sha256:' || repeat('a', 64), repeat('c', 40),
  'sha256:' || repeat('b', 64), 'sha256:' || repeat('d', 64),
  current_setting('test.prefix') || '/archive.zip', 1, 10,
  jsonb_build_array(jsonb_build_object(
    'relativePath', 'changed.json', 'pathKey', 'brand.json',
    'contentSha256', 'sha256:' || repeat('e', 64), 'mimeType', 'application/json',
    'byteSize', 10, 'previewKind', 'text',
    'objectPath', current_setting('test.prefix') || '/files/brand.json')),
  current_setting('test.upload_id')::uuid
) $test$, '23514', 'tenant_package_upload_mismatch',
  'a retry cannot substitute different file metadata');
select throws_ok($test$ select public.stage_tenant_package(
  'dddddddd-dddd-dddd-dddd-dddddddddddd', 'replay-2026.09.08',
  'sha256:' || repeat('a', 64), repeat('c', 40),
  'sha256:' || repeat('b', 64), 'sha256:' || repeat('d', 64),
  current_setting('test.prefix') || '/archive.zip', 1, 10,
  jsonb_build_array(
    jsonb_build_object('relativePath', 'brand.json', 'pathKey', 'brand.json',
      'contentSha256', 'sha256:' || repeat('e', 64), 'mimeType', 'application/json',
      'byteSize', 10, 'previewKind', 'text',
      'objectPath', current_setting('test.prefix') || '/files/brand.json'),
    jsonb_build_object('relativePath', 'copy.json', 'pathKey', 'brand.json',
      'contentSha256', 'sha256:' || repeat('e', 64), 'mimeType', 'application/json',
      'byteSize', 10, 'previewKind', 'text',
      'objectPath', current_setting('test.prefix') || '/files/brand.json')),
  current_setting('test.upload_id')::uuid
) $test$, '23514', 'tenant_package_upload_mismatch',
  'duplicate input keys cannot disguise a changed replay manifest');
reset role;

select set_config('test.multibyte_prefix',
  'dddddddd-dddd-dddd-dddd-dddddddddddd/' || repeat('1', 64) || '/' || repeat('2', 64), true);
insert into storage.objects (id, bucket_id, name) values
  (gen_random_uuid(), 'tenant-packages', current_setting('test.multibyte_prefix') || '/archive.zip'),
  (gen_random_uuid(), 'tenant-packages', current_setting('test.multibyte_prefix') || '/files/' || repeat('é', 600));
set local role service_role;
select set_config('test.multibyte_upload_id', public.begin_tenant_package_upload(
  'dddddddd-dddd-dddd-dddd-dddddddddddd', 'multibyte-reject',
  'sha256:' || repeat('1', 64), repeat('3', 40),
  'sha256:' || repeat('2', 64), 'sha256:' || repeat('4', 64),
  current_setting('test.multibyte_prefix'), 1, 1
)::text, true);
select throws_ok($test$ select public.stage_tenant_package(
  'dddddddd-dddd-dddd-dddd-dddddddddddd', 'multibyte-reject',
  'sha256:' || repeat('1', 64), repeat('3', 40),
  'sha256:' || repeat('2', 64), 'sha256:' || repeat('4', 64),
  current_setting('test.multibyte_prefix') || '/archive.zip', 1, 1,
  jsonb_build_array(jsonb_build_object(
    'relativePath', repeat('é', 600), 'pathKey', repeat('é', 600),
    'contentSha256', 'sha256:' || repeat('5', 64), 'mimeType', 'text/plain',
    'byteSize', 1, 'previewKind', 'text',
    'objectPath', current_setting('test.multibyte_prefix') || '/files/' || repeat('é', 600))),
  current_setting('test.multibyte_upload_id')::uuid
) $test$, '22023', 'tenant_package_file_invalid',
  'the 1,024-byte path limit rejects 600 two-byte characters');
reset role;

select set_config('test.long_prefix',
  'dddddddd-dddd-dddd-dddd-dddddddddddd/' || repeat('6', 64) || '/' || repeat('7', 64), true);
insert into storage.objects (id, bucket_id, name) values
  (gen_random_uuid(), 'tenant-packages', current_setting('test.long_prefix') || '/archive.zip'),
  (gen_random_uuid(), 'tenant-packages', current_setting('test.long_prefix') || '/files/' || repeat('x', 1024));
set local role service_role;
select set_config('test.long_upload_id', public.begin_tenant_package_upload(
  'dddddddd-dddd-dddd-dddd-dddddddddddd', 'long-path-valid',
  'sha256:' || repeat('6', 64), repeat('8', 40),
  'sha256:' || repeat('7', 64), 'sha256:' || repeat('9', 64),
  current_setting('test.long_prefix'), 1, 1
)::text, true);
select ok(public.stage_tenant_package(
  'dddddddd-dddd-dddd-dddd-dddddddddddd', 'long-path-valid',
  'sha256:' || repeat('6', 64), repeat('8', 40),
  'sha256:' || repeat('7', 64), 'sha256:' || repeat('9', 64),
  current_setting('test.long_prefix') || '/archive.zip', 1, 1,
  jsonb_build_array(jsonb_build_object(
    'relativePath', repeat('x', 1024), 'pathKey', repeat('x', 1024),
    'contentSha256', 'sha256:' || repeat('a', 64), 'mimeType', 'text/plain',
    'byteSize', 1, 'previewKind', 'text',
    'objectPath', current_setting('test.long_prefix') || '/files/' || repeat('x', 1024))),
  current_setting('test.long_upload_id')::uuid
) is not null, 'a 1,024-byte path persists with its longer canonical object name');
reset role;

select set_config('test.overlong_prefix',
  'dddddddd-dddd-dddd-dddd-dddddddddddd/' || repeat('b', 64) || '/' || repeat('c', 64), true);
insert into storage.objects (id, bucket_id, name) values
  (gen_random_uuid(), 'tenant-packages', current_setting('test.overlong_prefix') || '/archive.zip'),
  (gen_random_uuid(), 'tenant-packages', current_setting('test.overlong_prefix') || '/files/' || repeat('y', 1025));
set local role service_role;
select set_config('test.overlong_upload_id', public.begin_tenant_package_upload(
  'dddddddd-dddd-dddd-dddd-dddddddddddd', 'long-path-reject',
  'sha256:' || repeat('b', 64), repeat('d', 40),
  'sha256:' || repeat('c', 64), 'sha256:' || repeat('e', 64),
  current_setting('test.overlong_prefix'), 1, 1
)::text, true);
select throws_ok($test$ select public.stage_tenant_package(
  'dddddddd-dddd-dddd-dddd-dddddddddddd', 'long-path-reject',
  'sha256:' || repeat('b', 64), repeat('d', 40),
  'sha256:' || repeat('c', 64), 'sha256:' || repeat('e', 64),
  current_setting('test.overlong_prefix') || '/archive.zip', 1, 1,
  jsonb_build_array(jsonb_build_object(
    'relativePath', repeat('y', 1025), 'pathKey', repeat('y', 1025),
    'contentSha256', 'sha256:' || repeat('f', 64), 'mimeType', 'text/plain',
    'byteSize', 1, 'previewKind', 'text',
    'objectPath', current_setting('test.overlong_prefix') || '/files/' || repeat('y', 1025))),
  current_setting('test.overlong_upload_id')::uuid
) $test$, '22023', 'tenant_package_file_invalid',
  'a 1,025-byte path is rejected');

select * from finish();
rollback;
