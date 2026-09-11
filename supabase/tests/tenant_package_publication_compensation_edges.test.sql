begin;
create extension if not exists pgtap with schema extensions;
set search_path = extensions, public, pg_catalog;
select plan(23);

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
  ('d1000000-0000-4000-8000-000000000001','comp-first-edge','Comp First Edge','active'),
  ('d1000000-0000-4000-8000-000000000002','comp-code-edge','Comp Code Edge','active'),
  ('d1000000-0000-4000-8000-000000000003','comp-absent-edge','Comp Absent Edge','active');
insert into public.organization_readiness_checks
  (brand_id,check_key,status,evidence,checked_at) values
  ('d1000000-0000-4000-8000-000000000001','tenant_artifacts','passed',
   '{"artifactDigest":"sha256:1111111111111111111111111111111111111111111111111111111111111111"}',now()),
  ('d1000000-0000-4000-8000-000000000001','release_approval','pending','{}',null),
  ('d1000000-0000-4000-8000-000000000002','tenant_artifacts','passed',
   '{"artifactDigest":"sha256:2222222222222222222222222222222222222222222222222222222222222222"}',now()),
  ('d1000000-0000-4000-8000-000000000002','release_approval','pending','{}',null),
  ('d1000000-0000-4000-8000-000000000003','tenant_artifacts','passed',
   '{"artifactDigest":"sha256:3333333333333333333333333333333333333333333333333333333333333333"}',now()),
  ('d1000000-0000-4000-8000-000000000003','release_approval','pending','{}',null);
insert into public.tenant_package_releases(
  id,brand_id,release_key,artifact_digest,source_commit_sha,envelope_sha256,
  archive_sha256,archive_object_path,file_count,total_bytes
) values
  ('d2000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000001',
   'release-first-edge','sha256:1111111111111111111111111111111111111111111111111111111111111111',
   '1111111111111111111111111111111111111111',
   'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
   'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
   'd1000000-0000-4000-8000-000000000001/first/archive.zip',1,10),
  ('d2000000-0000-4000-8000-000000000002','d1000000-0000-4000-8000-000000000002',
   'release-code-edge','sha256:2222222222222222222222222222222222222222222222222222222222222222',
   '2222222222222222222222222222222222222222',
   'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
   'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
   'd1000000-0000-4000-8000-000000000002/code/archive.zip',1,10);

set local role service_role;
select is(pg_temp.publish_current(
  'd1000000-0000-4000-8000-000000000001','release-first-edge',
  'sha256:1111111111111111111111111111111111111111111111111111111111111111',
  '4111111111111111111111111111111111111111','vercel:first-edge','github:first-edge'),
  'd2000000-0000-4000-8000-000000000001'::uuid,'a first publication succeeds');
select is((select target_previous_status from public.tenant_package_publication_events
  where brand_id='d1000000-0000-4000-8000-000000000001'),
  'verified'::text,'the first event captures its target before-image');
select is(public.compensate_tenant_package_publication(
  'd1000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001',
  '4111111111111111111111111111111111111111','vercel:first-edge','github:first-edge',
  'vercel:first-rollback','github:first-rollback',null,null,null,null),
  'compensated'::text,'the first publication is compensated');
select is((select count(*) from public.tenant_package_publications where
  brand_id='d1000000-0000-4000-8000-000000000001'),0::bigint,'the first pointer is removed');
select is((select status from public.tenant_package_releases where
  id='d2000000-0000-4000-8000-000000000001'),'verified'::text,'target state is restored');
select is((select status from public.organization_readiness_checks where
  brand_id='d1000000-0000-4000-8000-000000000001' and check_key='release_approval'),
  'failed'::text,'first rollback stays failed before provider confirmation');
select is(public.confirm_tenant_package_publication_compensation(
  'd1000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001',
  '4111111111111111111111111111111111111111','vercel:first-edge','github:first-edge'),
  'confirmed'::text,'provider restoration is confirmed');
select is((select status from public.organization_readiness_checks where
  brand_id='d1000000-0000-4000-8000-000000000001' and check_key='release_approval'),
  'failed'::text,'no-prior rollback remains unapproved after confirmation');
select is((select evidence->>'providerRollbackCompleted'
  from public.organization_readiness_checks where
  brand_id='d1000000-0000-4000-8000-000000000001' and check_key='release_approval'),
  'true'::text,'failed readiness records completed provider restoration');
select is(public.confirm_tenant_package_publication_compensation(
  'd1000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001',
  '4111111111111111111111111111111111111111','vercel:first-edge','github:first-edge'),
  'confirmed'::text,'first-publication confirmation is idempotent');
select is((select count(*) from public.tenant_package_publication_compensation_confirmations
  where brand_id='d1000000-0000-4000-8000-000000000001'),1::bigint,
  'idempotent confirmation keeps one audit row');

select is(pg_temp.publish_current(
  'd1000000-0000-4000-8000-000000000002','release-code-edge',
  'sha256:2222222222222222222222222222222222222222222222222222222222222222',
  '4222222222222222222222222222222222222222','vercel:code-a','github:code-a'),
  'd2000000-0000-4000-8000-000000000002'::uuid,'code-only baseline publishes');
select set_config('test.code_published',(select published_at::text
  from public.tenant_package_publications where brand_id='d1000000-0000-4000-8000-000000000002'),true);
select set_config('test.code_updated',(select updated_at::text
  from public.tenant_package_publications where brand_id='d1000000-0000-4000-8000-000000000002'),true);
select is(pg_temp.publish_current(
  'd1000000-0000-4000-8000-000000000002','release-code-edge',
  'sha256:2222222222222222222222222222222222222222222222222222222222222222',
  '5222222222222222222222222222222222222222','vercel:code-b','github:code-b'),
  'd2000000-0000-4000-8000-000000000002'::uuid,'code-only replacement publishes');
select is((select previous_package_release_id from public.tenant_package_publication_events
  where deployment_commit_sha='5222222222222222222222222222222222222222'),
  'd2000000-0000-4000-8000-000000000002'::uuid,'code event snapshots the same release');
select is(public.compensate_tenant_package_publication(
  'd1000000-0000-4000-8000-000000000002','d2000000-0000-4000-8000-000000000002',
  '5222222222222222222222222222222222222222','vercel:code-b','github:code-b',
  'vercel:code-rollback','github:code-rollback','d2000000-0000-4000-8000-000000000002',
  'sha256:2222222222222222222222222222222222222222222222222222222222222222',
  '4222222222222222222222222222222222222222',current_setting('test.code_published')::timestamptz),
  'compensated'::text,'code-only publication is compensated');
select is((select deployment_commit_sha from public.tenant_package_publications where
  brand_id='d1000000-0000-4000-8000-000000000002'),
  '4222222222222222222222222222222222222222'::text,'the prior pointer commit returns');
select is((select updated_at from public.tenant_package_publications where
  brand_id='d1000000-0000-4000-8000-000000000002'),
  current_setting('test.code_updated')::timestamptz,'the prior pointer version returns');
select is((select deployment_commit_sha from public.tenant_package_releases where
  id='d2000000-0000-4000-8000-000000000002'),
  '4222222222222222222222222222222222222222'::text,'the release commit returns');
select is(public.confirm_tenant_package_publication_compensation(
  'd1000000-0000-4000-8000-000000000002','d2000000-0000-4000-8000-000000000002',
  '5222222222222222222222222222222222222222','vercel:code-b','github:code-b'),
  'confirmed'::text,'code-only provider rollback confirms');
select is((select status from public.organization_readiness_checks where
  brand_id='d1000000-0000-4000-8000-000000000002' and check_key='release_approval'),
  'passed'::text,'code-only confirmation restores approval');

select is(public.compensate_tenant_package_publication(
  'd1000000-0000-4000-8000-000000000003','d2000000-0000-4000-8000-000000000099',
  '4333333333333333333333333333333333333333','vercel:absent','github:absent',
  'vercel:absent-rollback','github:absent-rollback',null,null,null,null),
  'not_committed'::text,'an absent event with an empty pointer is reconciled');
select throws_ok($q$select public.compensate_tenant_package_publication(
  'd1000000-0000-4000-8000-000000000003','d2000000-0000-4000-8000-000000000099',
  '4333333333333333333333333333333333333333','vercel:absent','github:absent',
  'vercel:absent-rollback','github:absent-rollback','d2000000-0000-4000-8000-000000000099',
  null,null,null)$q$,'22023','tenant_package_compensation_invalid',
  'partial prior tuples are rejected');
select throws_ok($q$select public.confirm_tenant_package_publication_compensation(
  'd1000000-0000-4000-8000-000000000003','d2000000-0000-4000-8000-000000000099',
  null,'vercel:absent','github:absent')$q$,'22023','tenant_package_compensation_invalid',
  'confirmation rejects null evidence');
reset role;
select * from finish();
rollback;
