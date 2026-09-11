begin;
create extension if not exists pgtap with schema extensions;
set search_path = extensions, public, pg_catalog;
select plan(16);

insert into auth.users (id, email) values
  ('b1000000-0000-4000-8000-000000000001','owner@publication-rls.test'),
  ('b1000000-0000-4000-8000-000000000002','staff@publication-rls.test'),
  ('b1000000-0000-4000-8000-000000000003','admin@publication-rls.test'),
  ('b1000000-0000-4000-8000-000000000004','suspended@publication-rls.test');
insert into public.brands (id, slug, name, status) values
  ('b2000000-0000-4000-8000-000000000001','publication-rls-active','RLS Active','active'),
  ('b2000000-0000-4000-8000-000000000002','publication-rls-admin','RLS Admin','active'),
  ('b2000000-0000-4000-8000-000000000003','publication-rls-suspended','RLS Suspended','suspended');
insert into public.brand_users (user_id, brand_id, role) values
  ('b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','brand_owner'),
  ('b1000000-0000-4000-8000-000000000002','b2000000-0000-4000-8000-000000000001','staff'),
  ('b1000000-0000-4000-8000-000000000003','b2000000-0000-4000-8000-000000000002','platform_admin'),
  ('b1000000-0000-4000-8000-000000000004','b2000000-0000-4000-8000-000000000003','brand_owner');
insert into public.tenant_package_releases (
  id,brand_id,release_key,artifact_digest,source_commit_sha,deployment_commit_sha,
  envelope_sha256,archive_sha256,archive_object_path,file_count,total_bytes,
  status,published_at,superseded_at,object_retention_until
) values
  ('b3000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001',
   'release-rls-old','sha256:1111111111111111111111111111111111111111111111111111111111111111',
   '1111111111111111111111111111111111111111','3111111111111111111111111111111111111111',
   'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
   'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
   'b2000000-0000-4000-8000-000000000001/old/archive.zip',1,10,'superseded',
   now()-interval '2 hours',now()-interval '1 hour',now()+interval '1 year'),
  ('b3000000-0000-4000-8000-000000000002','b2000000-0000-4000-8000-000000000001',
   'release-rls-current','sha256:2222222222222222222222222222222222222222222222222222222222222222',
   '2222222222222222222222222222222222222222','3222222222222222222222222222222222222222',
   'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
   'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
   'b2000000-0000-4000-8000-000000000001/current/archive.zip',1,10,'published',now(),null,null);
insert into public.tenant_package_files (
  id,brand_id,package_release_id,relative_path,path_key,content_sha256,
  mime_type,byte_size,preview_kind,object_path
) values
  ('b4000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001',
   'b3000000-0000-4000-8000-000000000001','old.json','old.json',
   'sha256:3333333333333333333333333333333333333333333333333333333333333333',
   'application/json',10,'text','b2000000-0000-4000-8000-000000000001/old/files/old.json'),
  ('b4000000-0000-4000-8000-000000000002','b2000000-0000-4000-8000-000000000001',
   'b3000000-0000-4000-8000-000000000002','current.json','current.json',
   'sha256:4444444444444444444444444444444444444444444444444444444444444444',
   'application/json',10,'text','b2000000-0000-4000-8000-000000000001/current/files/current.json');
insert into public.tenant_package_publications (
  brand_id,current_release_id,artifact_digest,deployment_commit_sha,published_at
) values (
  'b2000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000002',
  'sha256:2222222222222222222222222222222222222222222222222222222222222222',
  '3222222222222222222222222222222222222222',now());

set local role authenticated;
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000001',true);
select is((select count(*) from public.tenant_package_releases),1::bigint,
  'an active owner sees one release');
select is((select id from public.tenant_package_releases),
  'b3000000-0000-4000-8000-000000000002'::uuid,'an owner sees only the current release');
select is((select count(*) from public.tenant_package_files),1::bigint,
  'an active owner sees one file');
select is((select id from public.tenant_package_files),
  'b4000000-0000-4000-8000-000000000002'::uuid,'an owner cannot see superseded files');

select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000002',true);
select is((select count(*) from public.tenant_package_releases),0::bigint,'staff see no releases');
select is((select count(*) from public.tenant_package_files),0::bigint,'staff see no files');

select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000003',true);
select is((select count(*) from public.tenant_package_releases),1::bigint,
  'an authoritative platform admin sees one release');
select is((select id from public.tenant_package_releases),
  'b3000000-0000-4000-8000-000000000002'::uuid,'an admin sees only the current release');
select is((select count(*) from public.tenant_package_files),1::bigint,
  'an authoritative platform admin sees one file');
select is((select id from public.tenant_package_files),
  'b4000000-0000-4000-8000-000000000002'::uuid,'an admin cannot see superseded files');

select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000004',true);
select is((select count(*) from public.tenant_package_releases),0::bigint,
  'a suspended brand owner sees no releases');
select is((select count(*) from public.tenant_package_files),0::bigint,
  'a suspended brand owner sees no files');

reset role;
delete from public.brand_users where user_id='b1000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000001',true);
select is((select count(*) from public.tenant_package_releases),0::bigint,
  'revoking owner membership immediately hides releases');
select is((select count(*) from public.tenant_package_files),0::bigint,
  'revoking owner membership immediately hides files');

reset role;
set local role anon;
select throws_ok('select * from public.tenant_package_releases','42501',null,
  'anonymous callers cannot query release metadata');
select throws_ok('select * from public.tenant_package_files','42501',null,
  'anonymous callers cannot query file metadata');
reset role;
select * from finish();
rollback;
