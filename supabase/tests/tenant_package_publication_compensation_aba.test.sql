begin;
create extension if not exists pgtap with schema extensions;
set search_path = extensions, public, pg_catalog;
select plan(17);

create function pg_temp.publish_current(
  p_brand uuid,p_key text,p_digest text,p_commit text,p_canary text,p_approval text
) returns uuid language plpgsql security invoker set search_path='' as $$
declare prior public.tenant_package_publications%rowtype;
begin
  select * into prior from public.tenant_package_publications where brand_id=p_brand;
  return public.publish_tenant_package_if_current(
    p_brand,p_key,p_digest,p_commit,p_canary,p_approval,prior.current_release_id,
    prior.artifact_digest,prior.deployment_commit_sha,prior.published_at);
end $$;

insert into public.brands(id,slug,name,status) values
  ('e1000000-0000-4000-8000-000000000001','comp-aba','Comp ABA','active');
insert into public.organization_readiness_checks
  (brand_id,check_key,status,evidence,checked_at) values
  ('e1000000-0000-4000-8000-000000000001','tenant_artifacts','passed',
   '{"artifactDigest":"sha256:1111111111111111111111111111111111111111111111111111111111111111"}',now()),
  ('e1000000-0000-4000-8000-000000000001','release_approval','pending','{}',null);
insert into public.tenant_package_releases(
  id,brand_id,release_key,artifact_digest,source_commit_sha,envelope_sha256,
  archive_sha256,archive_object_path,file_count,total_bytes
) values
  ('e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001',
   'release-aba-a','sha256:1111111111111111111111111111111111111111111111111111111111111111',
   '1111111111111111111111111111111111111111',
   'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
   'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
   'e1000000-0000-4000-8000-000000000001/a/archive.zip',1,10),
  ('e2000000-0000-4000-8000-000000000002','e1000000-0000-4000-8000-000000000001',
   'release-aba-b','sha256:2222222222222222222222222222222222222222222222222222222222222222',
   '2222222222222222222222222222222222222222',
   'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
   'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
   'e1000000-0000-4000-8000-000000000001/b/archive.zip',1,10);
insert into storage.objects(id,bucket_id,name) values
  (gen_random_uuid(),'tenant-packages','e1000000-0000-4000-8000-000000000001/a/archive.zip');

set local role service_role;
select is(pg_temp.publish_current(
  'e1000000-0000-4000-8000-000000000001','release-aba-a',
  'sha256:1111111111111111111111111111111111111111111111111111111111111111',
  '4111111111111111111111111111111111111111','vercel:aba-a','github:aba-a'),
  'e2000000-0000-4000-8000-000000000001'::uuid,'A publishes');
select set_config('test.a_published',(select published_at::text
  from public.tenant_package_publications),true);
select public.record_organization_readiness(
  'e1000000-0000-4000-8000-000000000001','tenant_artifacts',true,
  '{"artifactDigest":"sha256:2222222222222222222222222222222222222222222222222222222222222222"}');
select is(pg_temp.publish_current(
  'e1000000-0000-4000-8000-000000000001','release-aba-b',
  'sha256:2222222222222222222222222222222222222222222222222222222222222222',
  '4222222222222222222222222222222222222222','vercel:aba-b1','github:aba-b1'),
  'e2000000-0000-4000-8000-000000000002'::uuid,'B first publishes');
select is(public.compensate_tenant_package_publication(
  'e1000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000002',
  '4222222222222222222222222222222222222222','vercel:aba-b1','github:aba-b1',
  'vercel:aba-rb1','github:aba-rb1','e2000000-0000-4000-8000-000000000001',
  'sha256:1111111111111111111111111111111111111111111111111111111111111111',
  '4111111111111111111111111111111111111111',current_setting('test.a_published')::timestamptz),
  'compensated'::text,'B first compensation restores A');
select is(public.confirm_tenant_package_publication_compensation(
  'e1000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000002',
  '4222222222222222222222222222222222222222','vercel:aba-b1','github:aba-b1'),
  'confirmed'::text,'B first provider rollback confirms');
select is((select status from public.organization_readiness_checks
  where check_key='release_approval'),'passed'::text,'A is approved after first confirmation');
select lives_ok($q$select public.record_organization_readiness(
  'e1000000-0000-4000-8000-000000000001','tenant_artifacts',true,
  '{"artifactDigest":"sha256:2222222222222222222222222222222222222222222222222222222222222222"}')$q$,
  'B can be staged again after confirmation');
select is(pg_temp.publish_current(
  'e1000000-0000-4000-8000-000000000001','release-aba-b',
  'sha256:2222222222222222222222222222222222222222222222222222222222222222',
  '5222222222222222222222222222222222222222','vercel:aba-b2','github:aba-b2'),
  'e2000000-0000-4000-8000-000000000002'::uuid,'B publishes a newer event');
select is(public.compensate_tenant_package_publication(
  'e1000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000002',
  '5222222222222222222222222222222222222222','vercel:aba-b2','github:aba-b2',
  'vercel:aba-rb2','github:aba-rb2','e2000000-0000-4000-8000-000000000001',
  'sha256:1111111111111111111111111111111111111111111111111111111111111111',
  '4111111111111111111111111111111111111111',current_setting('test.a_published')::timestamptz),
  'compensated'::text,'newer B compensation restores A');
select is((select status from public.organization_readiness_checks
  where check_key='release_approval'),'failed'::text,'newer compensation is pending');
select throws_ok($q$select public.confirm_tenant_package_publication_compensation(
  'e1000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000002',
  '4222222222222222222222222222222222222222','vercel:aba-b1','github:aba-b1')$q$,
  '23514','tenant_package_compensation_conflict','stale confirmation cannot pass readiness');
select is((select status from public.organization_readiness_checks
  where check_key='release_approval'),'failed'::text,'stale confirmation leaves readiness failed');
select is((select evidence->>'providerRollbackPending' from public.organization_readiness_checks
  where check_key='release_approval'),'true'::text,'newer rollback remains pending');
select throws_ok($q$select public.compensate_tenant_package_publication(
  'e1000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001',
  '4111111111111111111111111111111111111111','vercel:aba-a','github:aba-a',
  'vercel:aba-a-rb','github:aba-a-rb',null,null,null,null)$q$,
  '23514','tenant_package_compensation_conflict','late A compensation cannot undo newer work');
select is((select current_release_id from public.tenant_package_publications),
  'e2000000-0000-4000-8000-000000000001'::uuid,'the exact restored pointer remains A');
select is((select count(*) from public.tenant_package_publication_compensations),
  2::bigint,'only the two valid B compensations are audited');
select is((select count(*) from public.tenant_package_publication_compensation_confirmations),
  1::bigint,'the newer pending compensation has no confirmation');
select ok((select max(id)>min(id) from public.tenant_package_publication_events),
  'brand-serialized event ids form the ABA generation fence');
reset role;
select * from finish();
rollback;
