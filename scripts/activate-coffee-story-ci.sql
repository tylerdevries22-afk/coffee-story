\set ON_ERROR_STOP on

-- Exercise the same immutable-evidence and activation RPCs as the HQ release
-- workflow. Values are produced by the clean runner from the checked-out
-- tenant artifact and Git revision; no readiness row is edited directly.
begin;

set local role service_role;
select public.record_organization_readiness(
  'c1000000-0000-4000-8000-000000000004',
  'tenant_artifacts', true,
  jsonb_build_object('artifactDigest', :'artifact_digest')
);
select public.record_organization_readiness(
  'c1000000-0000-4000-8000-000000000004',
  'release_approval', true,
  jsonb_build_object(
    'artifactDigest', :'artifact_digest',
    'commitSha', :'commit_sha',
    'providerReference', :'provider_reference'
  )
);

reset role;
set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', 'c1000000-0000-4000-8000-000000000001',
  'role', 'authenticated',
  'app_metadata', jsonb_build_object(
    'role', 'platform_admin',
    'brand_id', 'c1000000-0000-4000-8000-000000000003',
    'location_ids', jsonb_build_array()
  )
)::text, true);
select set_config(
  'request.jwt.claim.sub', 'c1000000-0000-4000-8000-000000000001', true
);

select public.activate_platform_organization(
  'c1000000-0000-4000-8000-000000000004'
);

commit;
