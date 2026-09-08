begin;
create extension if not exists pgtap with schema extensions;
set search_path = extensions, public, pg_catalog;
select plan(31);

select has_table('public', 'tenant_package_releases', 'package releases are durable');
select has_table('public', 'tenant_package_files', 'package files are indexed');
select has_table('public', 'tenant_package_publications', 'current package has one pointer');
select has_table('public', 'tenant_package_access_events', 'package access is audited');
select has_column('public', 'tenant_package_files', 'preview_object_path',
  'sanitized raster preview objects are recorded');
select has_column('public', 'tenant_package_files', 'preview_content_sha256',
  'sanitized raster previews are digest-bound');
select has_function('app', 'can_read_tenant_package', array['uuid'],
  'package authorization resolves authoritative membership');
select has_function('public', 'publish_tenant_package',
  array['uuid','text','text','text','text','text'], 'atomic promotion exists');
select ok(has_table_privilege('authenticated', 'public.tenant_package_files', 'SELECT'),
  'authenticated clients can request RLS-filtered metadata');
select ok(not has_table_privilege('authenticated', 'public.tenant_package_files', 'INSERT,UPDATE,DELETE'),
  'authenticated clients cannot mutate package metadata');
select ok(not has_table_privilege('authenticated', 'public.tenant_package_access_events', 'SELECT'),
  'access audit rows are private');
select ok(not has_function_privilege('authenticated',
  'public.stage_tenant_package(uuid,text,text,text,text,text,text,integer,bigint,jsonb)', 'EXECUTE'),
  'only the service role can stage a package');
select ok(not exists (select 1 from pg_policies where schemaname = 'storage'
  and tablename = 'objects' and coalesce(qual, '') like '%tenant-packages%'),
  'the private bucket has no authenticated object policy');

insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'owner@package.test'),
  ('22222222-2222-4222-8222-222222222222', 'staff@package.test'),
  ('33333333-3333-4333-8333-333333333333', 'admin@package.test'),
  ('44444444-4444-4444-8444-444444444444', 'suspended@package.test');
insert into public.brands (id, slug, name, status) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'package-active', 'Package Active', 'active'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'package-other', 'Package Other', 'active'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'package-suspended', 'Package Suspended', 'suspended');
insert into public.brand_users (user_id, brand_id, role) values
  ('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'brand_owner'),
  ('22222222-2222-4222-8222-222222222222', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'staff'),
  ('33333333-3333-4333-8333-333333333333', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'platform_admin'),
  ('44444444-4444-4444-8444-444444444444', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'brand_owner');
insert into public.organization_readiness_checks (brand_id, check_key) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'tenant_artifacts'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'release_approval');
insert into storage.objects (id, bucket_id, name) values
  (gen_random_uuid(), 'tenant-packages',
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/archive.zip'),
  (gen_random_uuid(), 'tenant-packages',
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/files/brand.json');

set local role service_role;
select set_config('test.package_release_id', public.stage_tenant_package(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'release-2026.09.06',
  'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
  'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/archive.zip',
  1, 10, '[{"relativePath":"brand.json","pathKey":"brand.json","contentSha256":"sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee","mimeType":"application/json","byteSize":10,"previewKind":"text","objectPath":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/files/brand.json"}]'
)::text, true);
select is((select status from public.organization_readiness_checks
  where brand_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and check_key = 'tenant_artifacts'),
  'passed'::text, 'verified package records tenant artifact readiness');
select is(public.stage_tenant_package(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'release-2026.09.06',
  'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
  'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/archive.zip',
  1, 10, '[{"relativePath":"brand.json","pathKey":"brand.json","contentSha256":"sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee","mimeType":"application/json","byteSize":10,"previewKind":"text","objectPath":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/files/brand.json"}]'
), current_setting('test.package_release_id')::uuid, 'staging is safely idempotent');
select throws_ok($test$ select public.stage_tenant_package(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'release-2026.09.07',
  'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
  'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff/archive.zip',
  1, 10, '[{"relativePath":"../secret","pathKey":"secret","contentSha256":"sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee","mimeType":"text/plain","byteSize":10,"previewKind":"text","objectPath":"invalid"}]'
) $test$, '22023', 'tenant_package_file_invalid', 'traversal paths fail before publication');
select is(public.publish_tenant_package(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'release-2026.09.06',
  'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'vercel:canary-123', 'github:approval-123'
), current_setting('test.package_release_id')::uuid, 'matching evidence promotes atomically');
select throws_ok($test$ select public.publish_tenant_package(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'release-2026.09.06',
  'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', 'vercel:canary-123', 'github:approval-123'
) $test$, '23514', 'tenant_package_release_mismatch',
  'a published release cannot be rebound to another deployment commit');
select is((select artifact_digest from public.tenant_package_publications
  where brand_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'the current pointer uses the canonical digest');
select is((select evidence->>'artifactDigest' from public.organization_readiness_checks
  where brand_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and check_key = 'release_approval'),
  'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'release approval uses the same canonical digest');
select lives_ok(format($test$ select public.record_tenant_package_access(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', %L, null,
  '33333333-3333-4333-8333-333333333333', 'admin_override', 'allowed',
  '99999999-9999-4999-8999-999999999999', null, null, '{}') $test$,
  current_setting('test.package_release_id')), 'platform-admin access can be audited');
select throws_ok($test$ update public.tenant_package_access_events set outcome = 'failed' $test$,
  '42501', 'tenant_package_event_immutable', 'audit events are append-only');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select is((select count(*) from public.tenant_package_files), 1::bigint,
  'an active owner reads the current package metadata');
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
select is_empty($test$ select id from public.tenant_package_files $test$,
  'staff cannot read package metadata even with authenticated access');
select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated","app_metadata":{"role":"brand_owner"}}', true);
select is_empty($test$ select id from public.tenant_package_files $test$,
  'a stale promoted JWT cannot override the current staff membership');
select set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', true);
select is((select count(*) from public.tenant_package_files), 1::bigint,
  'an authoritative platform admin can read tenant package metadata');
select set_config('request.jwt.claim.sub', '44444444-4444-4444-8444-444444444444', true);
select is_empty($test$ select id from public.tenant_package_files $test$,
  'a suspended tenant owner is denied immediately');
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select is((select allowed from public.consume_tenant_package_download_budget(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'archive_download')), true,
  'the first ZIP download is within budget');
do $$ begin
  perform public.consume_tenant_package_download_budget(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'archive_download') from generate_series(1, 4);
end $$;
select is((select allowed from public.consume_tenant_package_download_budget(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'archive_download')), false,
  'the distributed ZIP budget rejects the sixth request');
reset role;

set local role service_role;
delete from public.brand_users where user_id = '11111111-1111-4111-8111-111111111111';
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select is_empty($test$ select id from public.tenant_package_files $test$,
  'removing membership revokes a stale owner token immediately');
reset role;
set local role anon;
select throws_ok($test$ select id from public.tenant_package_files $test$,
  '42501', null, 'anonymous clients cannot query package metadata');
reset role;

select * from finish();
rollback;
