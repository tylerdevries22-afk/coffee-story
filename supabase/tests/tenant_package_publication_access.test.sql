begin;
create extension if not exists pgtap with schema extensions;
set search_path = extensions, public, pg_catalog;
select plan(10);

insert into auth.users (id,email) values
  ('b5000000-0000-4000-8000-000000000001','owner@publication-access.test'),
  ('b5000000-0000-4000-8000-000000000002','admin@publication-access.test');
insert into public.brands (id,slug,name,status) values
  ('b6000000-0000-4000-8000-000000000001','publication-access','Access Brand','active'),
  ('b6000000-0000-4000-8000-000000000002','publication-access-admin','Admin Brand','active');
insert into public.brand_users (user_id,brand_id,role) values
  ('b5000000-0000-4000-8000-000000000001','b6000000-0000-4000-8000-000000000001','brand_owner'),
  ('b5000000-0000-4000-8000-000000000002','b6000000-0000-4000-8000-000000000002','platform_admin');
insert into public.tenant_package_releases (
  id,brand_id,release_key,artifact_digest,source_commit_sha,deployment_commit_sha,
  envelope_sha256,archive_sha256,archive_object_path,file_count,total_bytes,
  status,published_at,superseded_at,object_retention_until
) values
  ('b7000000-0000-4000-8000-000000000001','b6000000-0000-4000-8000-000000000001',
   'release-access-old','sha256:1111111111111111111111111111111111111111111111111111111111111111',
   '1111111111111111111111111111111111111111','3111111111111111111111111111111111111111',
   'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
   'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
   'b6000000-0000-4000-8000-000000000001/old/archive.zip',1,10,'superseded',
   now()-interval '2 hours',now()-interval '1 hour',now()+interval '1 year'),
  ('b7000000-0000-4000-8000-000000000002','b6000000-0000-4000-8000-000000000001',
   'release-access-current','sha256:2222222222222222222222222222222222222222222222222222222222222222',
   '2222222222222222222222222222222222222222','3222222222222222222222222222222222222222',
   'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
   'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
   'b6000000-0000-4000-8000-000000000001/current/archive.zip',1,10,'published',now(),null,null);
insert into public.tenant_package_files (
  id,brand_id,package_release_id,relative_path,path_key,content_sha256,
  mime_type,byte_size,preview_kind,object_path
) values
  ('b8000000-0000-4000-8000-000000000001','b6000000-0000-4000-8000-000000000001',
   'b7000000-0000-4000-8000-000000000001','old.json','old.json',
   'sha256:3333333333333333333333333333333333333333333333333333333333333333',
   'application/json',10,'text','b6000000-0000-4000-8000-000000000001/old/files/old.json'),
  ('b8000000-0000-4000-8000-000000000002','b6000000-0000-4000-8000-000000000001',
   'b7000000-0000-4000-8000-000000000002','current.json','current.json',
   'sha256:4444444444444444444444444444444444444444444444444444444444444444',
   'application/json',10,'text','b6000000-0000-4000-8000-000000000001/current/files/current.json');
insert into public.tenant_package_publications (
  brand_id,current_release_id,artifact_digest,deployment_commit_sha,published_at
) values (
  'b6000000-0000-4000-8000-000000000001','b7000000-0000-4000-8000-000000000002',
  'sha256:2222222222222222222222222222222222222222222222222222222222222222',
  '3222222222222222222222222222222222222222',now());

set local role service_role;
select lives_ok($q$select public.record_tenant_package_access(
  'b6000000-0000-4000-8000-000000000001','b7000000-0000-4000-8000-000000000002',null,
  'b5000000-0000-4000-8000-000000000002','admin_override','allowed',
  'b9000000-0000-4000-8000-000000000001',null,null,'{}')$q$,
  'platform-admin access can be audited');
select throws_ok($q$select public.record_tenant_package_access(
  'b6000000-0000-4000-8000-000000000001','b7000000-0000-4000-8000-000000000002',null,
  'b5000000-0000-4000-8000-000000000002','file_download','allowed',
  'b9000000-0000-4000-8000-000000000002',null,null,'{}')$q$,
  '23514','tenant_package_access_file_required','file downloads require a file');
select throws_ok($q$select public.record_tenant_package_access(
  'b6000000-0000-4000-8000-000000000001','b7000000-0000-4000-8000-000000000002',
  'b8000000-0000-4000-8000-000000000002','b5000000-0000-4000-8000-000000000002',
  'tree','allowed','b9000000-0000-4000-8000-000000000003',null,null,'{}')$q$,
  '23514','tenant_package_access_file_forbidden','tree events cannot claim one file');
select throws_ok($q$select public.record_tenant_package_access(
  'b6000000-0000-4000-8000-000000000001','b7000000-0000-4000-8000-000000000002',
  'b8000000-0000-4000-8000-000000000001','b5000000-0000-4000-8000-000000000002',
  'file_download','allowed','b9000000-0000-4000-8000-000000000004',null,null,'{}')$q$,
  '23514','tenant_package_access_file_mismatch','files must belong to their release');
reset role;
select throws_ok($q$insert into public.tenant_package_access_events
  (brand_id,package_release_id,file_id,actor_id,action,outcome,request_id) values
  ('b6000000-0000-4000-8000-000000000001','b7000000-0000-4000-8000-000000000002',
   'b8000000-0000-4000-8000-000000000001','b5000000-0000-4000-8000-000000000002',
   'file_download','allowed','b9000000-0000-4000-8000-000000000005')$q$,
  '23503',null,'the composite foreign key rejects a cross-release file');
select throws_ok($q$insert into public.tenant_package_access_events
  (brand_id,package_release_id,file_id,actor_id,action,outcome,request_id) values
  ('b6000000-0000-4000-8000-000000000001','b7000000-0000-4000-8000-000000000002',null,
   'b5000000-0000-4000-8000-000000000002','file_download','allowed',
   'b9000000-0000-4000-8000-000000000006')$q$,
  '23514',null,'the table check rejects a file action without a file');
select throws_ok($q$update public.tenant_package_access_events set outcome='failed'$q$,
  '42501','tenant_package_event_immutable','access audit events are append-only');
select is((select count(*) from public.tenant_package_access_events),1::bigint,
  'only the valid access event is recorded');

set local role authenticated;
select set_config('request.jwt.claim.sub','b5000000-0000-4000-8000-000000000001',true);
select is((select allowed from public.consume_tenant_package_download_budget(
  'b6000000-0000-4000-8000-000000000001','archive_download')),true,
  'the first archive download is within budget');
do $$begin perform public.consume_tenant_package_download_budget(
  'b6000000-0000-4000-8000-000000000001','archive_download') from generate_series(1,4); end$$;
select is((select allowed from public.consume_tenant_package_download_budget(
  'b6000000-0000-4000-8000-000000000001','archive_download')),false,
  'the distributed archive budget rejects the sixth request');
reset role;
select * from finish();
rollback;
