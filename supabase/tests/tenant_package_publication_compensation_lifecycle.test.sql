begin;
create extension if not exists pgtap with schema extensions;
set search_path = extensions, public, pg_catalog;
select plan(32);

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
  ('c1000000-0000-4000-8000-000000000001','comp-lifecycle','Comp Lifecycle','active');
insert into public.organization_readiness_checks
  (brand_id,check_key,status,evidence,checked_at) values
  ('c1000000-0000-4000-8000-000000000001','tenant_artifacts','passed',
   '{"artifactDigest":"sha256:1111111111111111111111111111111111111111111111111111111111111111"}',now()),
  ('c1000000-0000-4000-8000-000000000001','release_approval','pending','{}',null);
insert into public.tenant_package_releases(
  id,brand_id,release_key,artifact_digest,source_commit_sha,envelope_sha256,
  archive_sha256,archive_object_path,file_count,total_bytes
) values
  ('c2000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001',
   'release-comp-a','sha256:1111111111111111111111111111111111111111111111111111111111111111',
   '1111111111111111111111111111111111111111',
   'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
   'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
   'c1000000-0000-4000-8000-000000000001/a/archive.zip',1,10),
  ('c2000000-0000-4000-8000-000000000002','c1000000-0000-4000-8000-000000000001',
   'release-comp-b','sha256:2222222222222222222222222222222222222222222222222222222222222222',
   '2222222222222222222222222222222222222222',
   'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
   'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
   'c1000000-0000-4000-8000-000000000001/b/archive.zip',1,10),
  ('c2000000-0000-4000-8000-000000000003','c1000000-0000-4000-8000-000000000001',
   'release-comp-c','sha256:3333333333333333333333333333333333333333333333333333333333333333',
   '3333333333333333333333333333333333333333',
   'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
   'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
   'c1000000-0000-4000-8000-000000000001/c/archive.zip',1,10);
insert into storage.objects(id,bucket_id,name) values
  (gen_random_uuid(),'tenant-packages','c1000000-0000-4000-8000-000000000001/a/archive.zip');

set local role service_role;
select is(pg_temp.publish_current(
  'c1000000-0000-4000-8000-000000000001','release-comp-a',
  'sha256:1111111111111111111111111111111111111111111111111111111111111111',
  '4111111111111111111111111111111111111111','vercel:comp-a','github:comp-a'),
  'c2000000-0000-4000-8000-000000000001'::uuid,'the baseline publishes');
select set_config('test.a_published',(select published_at::text from public.tenant_package_publications),true);
select set_config('test.a_updated',(select updated_at::text from public.tenant_package_publications),true);
select public.record_organization_readiness(
  'c1000000-0000-4000-8000-000000000001','tenant_artifacts',true,
  '{"artifactDigest":"sha256:2222222222222222222222222222222222222222222222222222222222222222"}');
select is(pg_temp.publish_current(
  'c1000000-0000-4000-8000-000000000001','release-comp-b',
  'sha256:2222222222222222222222222222222222222222222222222222222222222222',
  '4222222222222222222222222222222222222222','vercel:comp-b','github:comp-b'),
  'c2000000-0000-4000-8000-000000000002'::uuid,'the replacement publishes');
select is((select previous_updated_at from public.tenant_package_publication_events
  where package_release_id='c2000000-0000-4000-8000-000000000002'),
  current_setting('test.a_updated')::timestamptz,'the event snapshots the exact pointer version');
select is(public.compensate_tenant_package_publication(
  'c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000002',
  '4222222222222222222222222222222222222222','vercel:comp-b','github:comp-b',
  'vercel:rollback-b','github:rollback-b','c2000000-0000-4000-8000-000000000001',
  'sha256:1111111111111111111111111111111111111111111111111111111111111111',
  '4111111111111111111111111111111111111111',current_setting('test.a_published')::timestamptz),
  'compensated'::text,'database compensation succeeds');
select is((select current_release_id from public.tenant_package_publications),
  'c2000000-0000-4000-8000-000000000001'::uuid,'the prior pointer is restored');
select is((select published_at from public.tenant_package_publications),
  current_setting('test.a_published')::timestamptz,'the prior publication time is restored');
select is((select updated_at from public.tenant_package_publications),
  current_setting('test.a_updated')::timestamptz,'the exact pointer version is restored');
select is((select status from public.tenant_package_releases where id=
  'c2000000-0000-4000-8000-000000000001'),'published'::text,'the prior release is current');
select is((select status from public.tenant_package_releases where id=
  'c2000000-0000-4000-8000-000000000002'),'verified'::text,'the target before-image is restored');
select is((select count(*) from public.tenant_package_releases where status='published'),
  1::bigint,'one release remains published');
select is((select count(*) from public.tenant_package_publication_compensations),
  1::bigint,'compensation writes immutable audit evidence');
select is((select status from public.organization_readiness_checks
  where check_key='release_approval'),'failed'::text,'approval stays failed pending providers');
select is((select evidence->>'providerRollbackPending' from public.organization_readiness_checks
  where check_key='release_approval'),'true'::text,'readiness records pending provider restore');
select is((select evidence->>'artifactDigest' from public.organization_readiness_checks
  where check_key='tenant_artifacts'),
  'sha256:1111111111111111111111111111111111111111111111111111111111111111'::text,
  'artifact readiness returns to the restored digest');
select is(public.compensate_tenant_package_publication(
  'c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000002',
  '4222222222222222222222222222222222222222','vercel:comp-b','github:comp-b',
  'vercel:rollback-b','github:rollback-b','c2000000-0000-4000-8000-000000000001',
  'sha256:1111111111111111111111111111111111111111111111111111111111111111',
  '4111111111111111111111111111111111111111',current_setting('test.a_published')::timestamptz),
  'compensated'::text,'exact compensation retry reconciles from audit and pointer');
select throws_ok($q$select pg_temp.publish_current(
  'c1000000-0000-4000-8000-000000000001','release-comp-c',
  'sha256:3333333333333333333333333333333333333333333333333333333333333333',
  '4333333333333333333333333333333333333333','vercel:pending','github:pending')$q$,
  '23514','tenant_package_publication_conflict','publication waits for provider restore');
select throws_ok($q$select public.record_organization_readiness(
  'c1000000-0000-4000-8000-000000000001','release_approval',true,
  '{"commitSha":"4111111111111111111111111111111111111111","artifactDigest":"sha256:1111111111111111111111111111111111111111111111111111111111111111","providerReference":"github:bypass","canaryReference":"vercel:bypass"}')$q$,
  '23514','tenant_package_compensation_pending','approval cannot bypass confirmation');
select throws_ok($q$select public.record_organization_readiness(
  'c1000000-0000-4000-8000-000000000001','release_approval',false,
  '{"commitSha":"4111111111111111111111111111111111111111","artifactDigest":"sha256:1111111111111111111111111111111111111111111111111111111111111111","providerReference":"github:unrelated","canaryReference":"vercel:unrelated"}')$q$,
  '23514','tenant_package_compensation_pending','generic failure cannot erase pending evidence');
select is((select evidence->>'compensationId' from public.organization_readiness_checks
  where check_key='release_approval'),(select id::text
  from public.tenant_package_publication_compensations),
  'a rejected failure preserves the exact compensation binding');
select throws_ok($q$select public.record_organization_readiness(
  'c1000000-0000-4000-8000-000000000001','tenant_artifacts',true,
  '{"artifactDigest":"sha256:3333333333333333333333333333333333333333333333333333333333333333"}')$q$,
  '23514','tenant_package_compensation_pending','staging cannot drift during provider restore');
select is((select evidence->>'artifactDigest' from public.organization_readiness_checks
  where check_key='tenant_artifacts'),
  'sha256:1111111111111111111111111111111111111111111111111111111111111111'::text,
  'rejected staging leaves restored readiness intact');

reset role;
select lives_ok($q$update public.tenant_package_releases set status='failed',
  purge_reason='stale_verified',purge_started_at=now(),objects_purged_at=now()
  where id='c2000000-0000-4000-8000-000000000002'$q$,
  'retention may clean the failed noncurrent target');
set local role service_role;
select is(public.compensate_tenant_package_publication(
  'c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000002',
  '4222222222222222222222222222222222222222','vercel:comp-b','github:comp-b',
  'vercel:rollback-b','github:rollback-b','c2000000-0000-4000-8000-000000000001',
  'sha256:1111111111111111111111111111111111111111111111111111111111111111',
  '4111111111111111111111111111111111111111',current_setting('test.a_published')::timestamptz),
  'compensated'::text,'replay tolerates audited cleanup of the failed target');
select is(public.confirm_tenant_package_publication_compensation(
  'c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000002',
  '4222222222222222222222222222222222222222','vercel:comp-b','github:comp-b'),
  'confirmed'::text,'provider restoration confirms after target cleanup');
select is((select status from public.organization_readiness_checks
  where check_key='release_approval'),'passed'::text,'confirmation passes restored approval');
select is((select evidence->>'providerRollbackCompleted' from public.organization_readiness_checks
  where check_key='release_approval'),'true'::text,'readiness records completed restoration');
select is((select count(*) from public.tenant_package_publication_compensation_confirmations),
  1::bigint,'confirmation appends one audit row');
select is(public.confirm_tenant_package_publication_compensation(
  'c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000002',
  '4222222222222222222222222222222222222222','vercel:comp-b','github:comp-b'),
  'confirmed'::text,'confirmation retry is idempotent');
select is((select count(*) from public.tenant_package_publication_compensation_confirmations),
  1::bigint,'confirmation retry does not duplicate evidence');
select lives_ok($q$select public.record_organization_readiness(
  'c1000000-0000-4000-8000-000000000001','tenant_artifacts',true,
  '{"artifactDigest":"sha256:3333333333333333333333333333333333333333333333333333333333333333"}')$q$,
  'new staging proceeds after confirmation');
select is(pg_temp.publish_current(
  'c1000000-0000-4000-8000-000000000001','release-comp-c',
  'sha256:3333333333333333333333333333333333333333333333333333333333333333',
  '4333333333333333333333333333333333333333','vercel:comp-c','github:comp-c'),
  'c2000000-0000-4000-8000-000000000003'::uuid,'publication resumes after confirmation');
select is((select current_release_id from public.tenant_package_publications),
  'c2000000-0000-4000-8000-000000000003'::uuid,'the new pointer commits');
reset role;
select * from finish();
rollback;
