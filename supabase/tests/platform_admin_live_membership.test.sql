-- 20260912060000: is_platform_admin() must require both the platform_admin
-- JWT claim and a live brand_users row naming that role for auth.uid() -- the
-- claim alone (the pre-existing behaviour) lets an offboarded admin keep
-- cross-tenant read until their token expires.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = extensions, public, pg_catalog;
select plan(4);

insert into public.brands (id, slug, name) values
  ('f0000000-0000-4000-8000-000000000001',
   'platform-admin-live-membership', 'Platform Admin Live Membership');
insert into auth.users (id, email) values
  ('f0000000-1000-4000-8000-000000000001', 'offboard-candidate@example.test');

set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object(
  'role', 'authenticated',
  'app_metadata', jsonb_build_object('role', 'platform_admin')
)::text, true);
select set_config(
  'request.jwt.claim.sub', 'f0000000-1000-4000-8000-000000000001', true
);
select is(app.is_platform_admin(), false,
  'a platform_admin JWT claim with no brand_users row is not enough');
reset role;

-- Inserted with no jwt claim set on this connection, which
-- app.protect_platform_admin_grant (20260824072313) permits: a null
-- app.jwt_role() is the service/script bootstrap path, not a foreign claim.
insert into public.brand_users (user_id, brand_id, role, location_ids) values
  ('f0000000-1000-4000-8000-000000000001',
   'f0000000-0000-4000-8000-000000000001', 'platform_admin', '{}');

set local role authenticated;
select is(app.is_platform_admin(), true,
  'the JWT claim plus a live brand_users platform_admin row grants access');
reset role;

delete from public.brand_users
where user_id = 'f0000000-1000-4000-8000-000000000001'
  and brand_id = 'f0000000-0000-4000-8000-000000000001';

set local role authenticated;
select is(app.is_platform_admin(), false,
  'removing the membership revokes access again in the same session, '
  'without waiting for the still-valid token to expire');
reset role;

select lives_ok($test$select app.assert_platform_admin_is_live_membership()$test$,
  'release readiness verifies is_platform_admin reads a live brand_users row');

select * from finish();
rollback;
