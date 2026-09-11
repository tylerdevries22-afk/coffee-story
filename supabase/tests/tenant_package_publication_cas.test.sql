begin;
create extension if not exists pgtap with schema extensions;
set search_path = extensions, public, pg_catalog;
select plan(23);

create function pg_temp.publish_current(
  p_brand uuid, p_key text, p_digest text, p_commit text, p_canary text, p_approval text
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare prior public.tenant_package_publications%rowtype;
begin
  select * into prior from public.tenant_package_publications where brand_id = p_brand;
  return public.publish_tenant_package_if_current(
    p_brand, p_key, p_digest, p_commit, p_canary, p_approval,
    prior.current_release_id, prior.artifact_digest,
    prior.deployment_commit_sha, prior.published_at
  );
end $$;

insert into public.brands (id, slug, name, status) values
  ('a1000000-0000-4000-8000-000000000001','publication-cas','Publication CAS','active');
insert into public.organization_readiness_checks
  (brand_id, check_key, status, evidence, checked_at) values
  ('a1000000-0000-4000-8000-000000000001','tenant_artifacts','passed',
   '{"artifactDigest":"sha256:1111111111111111111111111111111111111111111111111111111111111111"}',now()),
  ('a1000000-0000-4000-8000-000000000001','release_approval','pending','{}',null);
insert into public.tenant_package_releases (
  id, brand_id, release_key, artifact_digest, source_commit_sha,
  envelope_sha256, archive_sha256, archive_object_path, file_count, total_bytes
) values
  ('a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001',
   'release-cas-one','sha256:1111111111111111111111111111111111111111111111111111111111111111',
   '1111111111111111111111111111111111111111',
   'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
   'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
   'a1000000-0000-4000-8000-000000000001/r1/archive.zip',1,10),
  ('a2000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000001',
   'release-cas-two','sha256:2222222222222222222222222222222222222222222222222222222222222222',
   '2222222222222222222222222222222222222222',
   'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
   'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
   'a1000000-0000-4000-8000-000000000001/r2/archive.zip',1,10),
  ('a2000000-0000-4000-8000-000000000003','a1000000-0000-4000-8000-000000000001',
   'release-cas-three','sha256:3333333333333333333333333333333333333333333333333333333333333333',
   '3333333333333333333333333333333333333333',
   'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
   'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
   'a1000000-0000-4000-8000-000000000001/r3/archive.zip',1,10);
insert into storage.objects (id,bucket_id,name) values
  (gen_random_uuid(),'tenant-packages','a1000000-0000-4000-8000-000000000001/r1/archive.zip');

set local role service_role;
select is(public.publish_tenant_package_if_current(
  'a1000000-0000-4000-8000-000000000001','release-cas-one',
  'sha256:1111111111111111111111111111111111111111111111111111111111111111',
  '4111111111111111111111111111111111111111','vercel:cas-one','github:cas-one',
  null,null,null,null), 'a2000000-0000-4000-8000-000000000001'::uuid,
  'an all-null expected tuple publishes the first release');
select is((select current_release_id from public.tenant_package_publications where brand_id='a1000000-0000-4000-8000-000000000001'),
  'a2000000-0000-4000-8000-000000000001'::uuid, 'first publication writes its pointer');
select is((select previous_package_release_id from public.tenant_package_publication_events where brand_id='a1000000-0000-4000-8000-000000000001'),
  null::uuid, 'first publication snapshots an absent pointer');
select is((select status from public.organization_readiness_checks
  where brand_id='a1000000-0000-4000-8000-000000000001' and check_key='release_approval'),'passed'::text,'publication passes matching approval');
select is(pg_temp.publish_current(
  'a1000000-0000-4000-8000-000000000001','release-cas-one',
  'sha256:1111111111111111111111111111111111111111111111111111111111111111',
  '4111111111111111111111111111111111111111','vercel:cas-one','github:cas-one'),
  'a2000000-0000-4000-8000-000000000001'::uuid,'an exact retry is idempotent');
select is((select count(*) from public.tenant_package_publication_events where brand_id='a1000000-0000-4000-8000-000000000001'),1::bigint,
  'an exact retry does not duplicate audit evidence');
select throws_ok($q$select public.publish_tenant_package_if_current(
  'a1000000-0000-4000-8000-000000000001','release-cas-two',
  'sha256:2222222222222222222222222222222222222222222222222222222222222222',
  '4222222222222222222222222222222222222222','vercel:partial','github:partial',
  'a2000000-0000-4000-8000-000000000001',null,null,null)$q$,
  '22023','tenant_package_publication_expectation_invalid','partial expected tuples are invalid');
select throws_ok($q$select public.publish_tenant_package_if_current(
  'a1000000-0000-4000-8000-000000000001','release-cas-two',
  'sha256:2222222222222222222222222222222222222222222222222222222222222222',
  '4222222222222222222222222222222222222222','vercel:stale-null','github:stale-null',
  null,null,null,null)$q$,'23514','tenant_package_publication_conflict',
  'all-null expectation is stale after first publication');
select set_config('test.r1_published_at',(select published_at::text
  from public.tenant_package_publications where brand_id='a1000000-0000-4000-8000-000000000001'),true);
select set_config('test.r1_updated_at',(select updated_at::text
  from public.tenant_package_publications where brand_id='a1000000-0000-4000-8000-000000000001'),true);
select lives_ok($q$select public.record_organization_readiness(
  'a1000000-0000-4000-8000-000000000001','tenant_artifacts',true,
  '{"artifactDigest":"sha256:2222222222222222222222222222222222222222222222222222222222222222"}')$q$,
  'the next verified artifact replaces readiness evidence');
select is(pg_temp.publish_current(
  'a1000000-0000-4000-8000-000000000001','release-cas-two',
  'sha256:2222222222222222222222222222222222222222222222222222222222222222',
  '4222222222222222222222222222222222222222','vercel:cas-two','github:cas-two'),
  'a2000000-0000-4000-8000-000000000002'::uuid,'an exact prior tuple publishes replacement');
select is((select previous_package_release_id from public.tenant_package_publication_events
  where package_release_id='a2000000-0000-4000-8000-000000000002'),
  'a2000000-0000-4000-8000-000000000001'::uuid,'replacement snapshots prior release');
select is((select previous_updated_at from public.tenant_package_publication_events
  where package_release_id='a2000000-0000-4000-8000-000000000002'),
  current_setting('test.r1_updated_at')::timestamptz,'replacement snapshots pointer version');
select throws_ok(format($q$select public.publish_tenant_package_if_current(
  'a1000000-0000-4000-8000-000000000001','release-cas-three',
  'sha256:3333333333333333333333333333333333333333333333333333333333333333',
  '4333333333333333333333333333333333333333','vercel:stale','github:stale',
  'a2000000-0000-4000-8000-000000000001',
  'sha256:1111111111111111111111111111111111111111111111111111111111111111',
  '4111111111111111111111111111111111111111',%L)$q$,
  current_setting('test.r1_published_at')),'23514','tenant_package_publication_conflict',
  'a stale exact tuple cannot overwrite replacement');
select is((select current_release_id from public.tenant_package_publications where brand_id='a1000000-0000-4000-8000-000000000001'),
  'a2000000-0000-4000-8000-000000000002'::uuid,'stale CAS leaves pointer unchanged');
select is(pg_temp.publish_current(
  'a1000000-0000-4000-8000-000000000001','release-cas-two',
  'sha256:2222222222222222222222222222222222222222222222222222222222222222',
  '5222222222222222222222222222222222222222','vercel:code-only','github:code-only'),
  'a2000000-0000-4000-8000-000000000002'::uuid,'code-only promotion uses exact current tuple');
select is((select deployment_commit_sha from public.tenant_package_publications where brand_id='a1000000-0000-4000-8000-000000000001'),
  '5222222222222222222222222222222222222222'::text,'pointer records code-only commit');
select throws_ok($q$select pg_temp.publish_current(
  'a1000000-0000-4000-8000-000000000001','release-cas-one',
  'sha256:1111111111111111111111111111111111111111111111111111111111111111',
  '4111111111111111111111111111111111111111','vercel:cas-one','github:cas-one')$q$,
  '23514','tenant_package_evidence_replayed','stale evidence cannot roll production back');
select throws_ok($q$select public.publish_tenant_package_if_current(
  'a1000000-0000-4000-8000-000000000001','release-cas-three',
  'sha256:3333333333333333333333333333333333333333333333333333333333333333',
  '4333333333333333333333333333333333333333','vercel:wrong','github:wrong',
  'a2000000-0000-4000-8000-000000000002',
  'sha256:9999999999999999999999999999999999999999999999999999999999999999',
  '5222222222222222222222222222222222222222',
  (select published_at from public.tenant_package_publications where brand_id='a1000000-0000-4000-8000-000000000001'))$q$,
  '23514','tenant_package_publication_conflict','mismatched tuple member is rejected');
select lives_ok($q$select public.record_organization_readiness(
  'a1000000-0000-4000-8000-000000000001','tenant_artifacts',true,
  '{"artifactDigest":"sha256:3333333333333333333333333333333333333333333333333333333333333333"}')$q$,
  'newer staging can advance artifact readiness');
select throws_ok($q$select pg_temp.publish_current(
  'a1000000-0000-4000-8000-000000000001','release-cas-two',
  'sha256:2222222222222222222222222222222222222222222222222222222222222222',
  '6222222222222222222222222222222222222222','vercel:old-artifact','github:old-artifact')$q$,
  '23514','tenant_package_release_artifact_mismatch',
  'approval cannot contradict current artifact readiness');
select is((select deployment_commit_sha from public.tenant_package_publications where brand_id='a1000000-0000-4000-8000-000000000001'),
  '5222222222222222222222222222222222222222'::text,'failed approval rolls pointer back');
select is((select count(*) from public.tenant_package_publication_events where brand_id='a1000000-0000-4000-8000-000000000001'),3::bigint,
  'failed publication rolls audit insertion back');
reset role;
update public.tenant_package_releases set
  purge_blocked_at=now(), purge_blocked_reason='noncanonical_objects'
where id='a2000000-0000-4000-8000-000000000003';
set local role service_role;
select throws_ok($q$select pg_temp.publish_current(
  'a1000000-0000-4000-8000-000000000001','release-cas-three',
  'sha256:3333333333333333333333333333333333333333333333333333333333333333',
  '4333333333333333333333333333333333333333','vercel:blocked','github:blocked')$q$,
  '23514','tenant_package_release_mismatch',
  'a cleanup-blocked verified release cannot publish');
reset role;
select * from finish();
rollback;
