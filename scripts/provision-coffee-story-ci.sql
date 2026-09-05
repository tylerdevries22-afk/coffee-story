\set ON_ERROR_STOP on

-- A disposable platform operator and owner let CI call the same authenticated,
-- atomic RPC as the HQ wizard. The resulting tenant is then reconciled from
-- tenants/coffee-story by `pnpm onboard`; no production guard is bypassed.
begin;

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('c1000000-0000-4000-8000-000000000001', 'platform-ci@example.test', '{}', '{}'),
  ('c1000000-0000-4000-8000-000000000002', 'owner-ci@example.test', '{}', '{}')
on conflict (id) do nothing;

insert into public.brands (
  id, slug, name, drops, catering, delivery, multi_location, sms,
  stored_value, referrals
) values (
  'c1000000-0000-4000-8000-000000000003', 'ci-platform', 'CI Platform',
  false, false, false, false, false, false, false
)
on conflict (id) do nothing;

insert into public.brand_users (user_id, brand_id, role, location_ids) values
  ('c1000000-0000-4000-8000-000000000001',
   'c1000000-0000-4000-8000-000000000003', 'platform_admin', '{}')
on conflict (user_id, brand_id) do nothing;

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

select public.provision_platform_organization_with_connectors(
  'c1000000-0000-4000-8000-000000000004',
  'Coffee Story', 'coffee-story',
  'c1000000-0000-4000-8000-000000000002', 'owner-ci@example.test',
  'independent', 'coffee-shop', 'coffee-shop', '{}',
  jsonb_build_object(
    'name', 'Coffee Story',
    'address', jsonb_build_object(),
    'hours', jsonb_build_object(),
    'timezone', 'America/Denver'
  ),
  '[]', null, '{}', '{}', '[]'
);

commit;
