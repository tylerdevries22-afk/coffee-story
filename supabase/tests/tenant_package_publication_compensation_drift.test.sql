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
  ('f1000000-0000-4000-8000-000000000001','comp-artifact-drift','Artifact Drift','active'),
  ('f1000000-0000-4000-8000-000000000002','comp-pointer-drift','Pointer Drift','active');
insert into public.organization_readiness_checks
  (brand_id,check_key,status,evidence,checked_at) values
  ('f1000000-0000-4000-8000-000000000001','tenant_artifacts','passed',
   '{"artifactDigest":"sha256:1111111111111111111111111111111111111111111111111111111111111111"}',now()),
  ('f1000000-0000-4000-8000-000000000001','release_approval','pending','{}',null),
  ('f1000000-0000-4000-8000-000000000002','tenant_artifacts','passed',
   '{"artifactDigest":"sha256:3333333333333333333333333333333333333333333333333333333333333333"}',now()),
  ('f1000000-0000-4000-8000-000000000002','release_approval','pending','{}',null);
insert into public.tenant_package_releases(
  id,brand_id,release_key,artifact_digest,source_commit_sha,envelope_sha256,
  archive_sha256,archive_object_path,file_count,total_bytes
) values
  ('f2000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000001',
   'release-drift-a','sha256:1111111111111111111111111111111111111111111111111111111111111111',
   '1111111111111111111111111111111111111111',
   'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
   'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
   'f1000000-0000-4000-8000-000000000001/a/archive.zip',1,10),
  ('f2000000-0000-4000-8000-000000000003','f1000000-0000-4000-8000-000000000002',
   'release-pointer-a','sha256:3333333333333333333333333333333333333333333333333333333333333333',
   '3333333333333333333333333333333333333333',
   'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
   'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
   'f1000000-0000-4000-8000-000000000002/a/archive.zip',1,10),
  ('f2000000-0000-4000-8000-000000000004','f1000000-0000-4000-8000-000000000002',
   'release-pointer-b','sha256:4444444444444444444444444444444444444444444444444444444444444444',
   '4444444444444444444444444444444444444444',
   'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
   'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
   'f1000000-0000-4000-8000-000000000002/b/archive.zip',1,10);
insert into storage.objects(id,bucket_id,name) values
  (gen_random_uuid(),'tenant-packages','f1000000-0000-4000-8000-000000000002/a/archive.zip');

set local role service_role;
select is(pg_temp.publish_current(
  'f1000000-0000-4000-8000-000000000001','release-drift-a',
  'sha256:1111111111111111111111111111111111111111111111111111111111111111',
  '4111111111111111111111111111111111111111','vercel:drift-a','github:drift-a'),
  'f2000000-0000-4000-8000-000000000001'::uuid,'artifact-drift baseline publishes');
select lives_ok($q$select public.record_organization_readiness(
  'f1000000-0000-4000-8000-000000000001','tenant_artifacts',true,
  '{"artifactDigest":"sha256:2222222222222222222222222222222222222222222222222222222222222222"}')$q$,
  'newer staging advances artifact readiness');
select throws_ok($q$select public.compensate_tenant_package_publication(
  'f1000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001',
  '4111111111111111111111111111111111111111','vercel:drift-a','github:drift-a',
  'vercel:drift-rb','github:drift-rb',null,null,null,null)$q$,
  '23514','tenant_package_compensation_conflict','late compensation cannot overwrite staging');
select is((select current_release_id from public.tenant_package_publications where
  brand_id='f1000000-0000-4000-8000-000000000001'),
  'f2000000-0000-4000-8000-000000000001'::uuid,'artifact conflict leaves pointer unchanged');
select is((select count(*) from public.tenant_package_publication_compensations where
  brand_id='f1000000-0000-4000-8000-000000000001'),0::bigint,'artifact conflict is not audited');
select is((select evidence->>'artifactDigest' from public.organization_readiness_checks where
  brand_id='f1000000-0000-4000-8000-000000000001' and check_key='tenant_artifacts'),
  'sha256:2222222222222222222222222222222222222222222222222222222222222222'::text,
  'artifact conflict preserves newer evidence');

select is(pg_temp.publish_current(
  'f1000000-0000-4000-8000-000000000002','release-pointer-a',
  'sha256:3333333333333333333333333333333333333333333333333333333333333333',
  '4333333333333333333333333333333333333333','vercel:pointer-a','github:pointer-a'),
  'f2000000-0000-4000-8000-000000000003'::uuid,'pointer-drift baseline publishes');
select set_config('test.pointer_published',(select published_at::text
  from public.tenant_package_publications where brand_id='f1000000-0000-4000-8000-000000000002'),true);
select public.record_organization_readiness(
  'f1000000-0000-4000-8000-000000000002','tenant_artifacts',true,
  '{"artifactDigest":"sha256:4444444444444444444444444444444444444444444444444444444444444444"}');
select is(pg_temp.publish_current(
  'f1000000-0000-4000-8000-000000000002','release-pointer-b',
  'sha256:4444444444444444444444444444444444444444444444444444444444444444',
  '4444444444444444444444444444444444444444','vercel:pointer-b','github:pointer-b'),
  'f2000000-0000-4000-8000-000000000004'::uuid,'pointer-drift replacement publishes');
select is(public.compensate_tenant_package_publication(
  'f1000000-0000-4000-8000-000000000002','f2000000-0000-4000-8000-000000000004',
  '4444444444444444444444444444444444444444','vercel:pointer-b','github:pointer-b',
  'vercel:pointer-rb','github:pointer-rb','f2000000-0000-4000-8000-000000000003',
  'sha256:3333333333333333333333333333333333333333333333333333333333333333',
  '4333333333333333333333333333333333333333',current_setting('test.pointer_published')::timestamptz),
  'compensated'::text,'pointer-drift replacement is compensated');
reset role;
select lives_ok($q$update public.tenant_package_publications
  set updated_at=updated_at+interval '1 millisecond'
  where brand_id='f1000000-0000-4000-8000-000000000002'$q$,
  'the test simulates otherwise invisible pointer ABA');
set local role service_role;
select throws_ok($q$select public.compensate_tenant_package_publication(
  'f1000000-0000-4000-8000-000000000002','f2000000-0000-4000-8000-000000000004',
  '4444444444444444444444444444444444444444','vercel:pointer-b','github:pointer-b',
  'vercel:pointer-rb','github:pointer-rb','f2000000-0000-4000-8000-000000000003',
  'sha256:3333333333333333333333333333333333333333333333333333333333333333',
  '4333333333333333333333333333333333333333',current_setting('test.pointer_published')::timestamptz)$q$,
  '23514','tenant_package_compensation_conflict','replay detects exact pointer drift');
select throws_ok($q$select public.confirm_tenant_package_publication_compensation(
  'f1000000-0000-4000-8000-000000000002','f2000000-0000-4000-8000-000000000004',
  '4444444444444444444444444444444444444444','vercel:pointer-b','github:pointer-b')$q$,
  '23514','tenant_package_compensation_conflict','confirmation detects exact pointer drift');
select is((select status from public.organization_readiness_checks where
  brand_id='f1000000-0000-4000-8000-000000000002' and check_key='release_approval'),
  'failed'::text,'pointer drift cannot pass readiness');
select is((select count(*) from public.tenant_package_publication_compensation_confirmations where
  brand_id='f1000000-0000-4000-8000-000000000002'),0::bigint,'pointer drift writes no confirmation');
select throws_ok($q$select public.compensate_tenant_package_publication(
  'f1000000-0000-4000-8000-000000000002','f2000000-0000-4000-8000-000000000099',
  '4999999999999999999999999999999999999999','vercel:missing','github:missing',
  'vercel:missing-rb','github:missing-rb','f2000000-0000-4000-8000-000000000003',
  'sha256:3333333333333333333333333333333333333333333333333333333333333333',
  '4333333333333333333333333333333333333333',current_setting('test.pointer_published')::timestamptz)$q$,
  '23514','tenant_package_compensation_conflict','no-event reconciliation refuses pending work');
select throws_ok($q$select public.record_organization_readiness(
  'f1000000-0000-4000-8000-000000000001','release_approval',true,
  '{"commitSha":"4111111111111111111111111111111111111111","artifactDigest":"sha256:1111111111111111111111111111111111111111111111111111111111111111","providerReference":"github:mismatch","canaryReference":"vercel:mismatch"}')$q$,
  '23514','tenant_package_release_artifact_mismatch','approval must match staged artifacts');
select is((select current_release_id from public.tenant_package_publications where
  brand_id='f1000000-0000-4000-8000-000000000002'),
  'f2000000-0000-4000-8000-000000000003'::uuid,'drift never changes the restored release id');
reset role;
select * from finish();
rollback;
