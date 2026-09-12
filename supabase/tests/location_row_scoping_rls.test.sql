-- Proves 20260912050000's fix with real rows and real role-switching, the
-- way activity_board_rls_test.sql already proves the device wall: a
-- location_manager or staff member scoped to one store must not read another
-- store's rows on the six tables that carried a location_id but were gated
-- on brand_id alone, and a staff member must not be able to rewrite a
-- location row at all (only its own store's manager, or the owner, may).
begin;
create extension if not exists pgtap with schema extensions;
set search_path = extensions, public, pg_catalog;
select plan(9);

-- The hosted Supabase stack grants `authenticated` USAGE on `extensions` by
-- default; the local db:local shim (scripts/local-supabase-shim.sql) does
-- not, since nothing else it applies needs a client role to reach that
-- schema. Grant it here, scoped to this rolled-back transaction, so pgtap's
-- own assertion functions stay reachable after the role switch below on
-- either harness.
grant usage on schema extensions to authenticated;

-- Fixtures, inserted as the table owner (RLS does not apply yet).
insert into public.brands (id, slug, name) values
  ('a0000000-1111-4000-8000-000000000001', 'loc-scope-test', 'Location Scope Test');
insert into public.locations (id, brand_id, name) values
  ('a0000000-1111-4000-8000-00000000000a', 'a0000000-1111-4000-8000-000000000001', 'Store A'),
  ('a0000000-1111-4000-8000-00000000000b', 'a0000000-1111-4000-8000-000000000001', 'Store B');
insert into auth.users (id, email) values
  ('a0000000-1111-4000-8000-0000000000f2', 'manager-a@loc-scope.test'),
  ('a0000000-1111-4000-8000-0000000000f3', 'staff-a@loc-scope.test');
insert into public.brand_users (id, user_id, brand_id, role, location_ids) values
  ('a0000000-1111-4000-8000-0000000000e2', 'a0000000-1111-4000-8000-0000000000f2',
    'a0000000-1111-4000-8000-000000000001', 'location_manager',
    array['a0000000-1111-4000-8000-00000000000a']::uuid[]),
  ('a0000000-1111-4000-8000-0000000000e3', 'a0000000-1111-4000-8000-0000000000f3',
    'a0000000-1111-4000-8000-000000000001', 'staff',
    array['a0000000-1111-4000-8000-00000000000a']::uuid[]);

-- crew_tasks: a per-store task, and a brand-wide template (location_id null).
insert into public.crew_tasks (id, brand_id, location_id, title) values
  ('a0000000-2222-4000-8000-00000000000a', 'a0000000-1111-4000-8000-000000000001',
    'a0000000-1111-4000-8000-00000000000a', 'Wipe espresso machine (A)'),
  ('a0000000-2222-4000-8000-00000000000b', 'a0000000-1111-4000-8000-000000000001',
    'a0000000-1111-4000-8000-00000000000b', 'Wipe espresso machine (B)'),
  ('a0000000-2222-4000-8000-000000000000', 'a0000000-1111-4000-8000-000000000001',
    null, 'Brand-wide opening checklist');

-- workforce_role_assignments: same per-store / brand-wide shape.
insert into public.workforce_roles (id, brand_id, slug, name) values
  ('a0000000-3333-4000-8000-000000000001', 'a0000000-1111-4000-8000-000000000001',
    'barista', 'Barista');
insert into public.workforce_role_assignments (id, brand_id, brand_user_id, workforce_role_id, location_id) values
  ('a0000000-3333-4000-8000-00000000000a', 'a0000000-1111-4000-8000-000000000001',
    'a0000000-1111-4000-8000-0000000000e3', 'a0000000-3333-4000-8000-000000000001',
    'a0000000-1111-4000-8000-00000000000a'),
  ('a0000000-3333-4000-8000-00000000000b', 'a0000000-1111-4000-8000-000000000001',
    'a0000000-1111-4000-8000-0000000000e3', 'a0000000-3333-4000-8000-000000000001',
    'a0000000-1111-4000-8000-00000000000b'),
  ('a0000000-3333-4000-8000-000000000000', 'a0000000-1111-4000-8000-000000000001',
    'a0000000-1111-4000-8000-0000000000e3', 'a0000000-3333-4000-8000-000000000001', null);

-- site_module_overrides: location_id is NOT NULL, so no brand-wide row.
-- A module_installations row has to exist for the (brand_id, module_key) FK,
-- and 20260903170000 makes app.create_module_installation the only writer.
select app.create_module_installation(
  'a0000000-1111-4000-8000-000000000001'::uuid, 'growth-drops', '1.0.0', null::jsonb,
  null::uuid, gen_random_uuid()
);
insert into public.site_module_overrides (id, brand_id, location_id, module_key) values
  ('a0000000-4444-4000-8000-00000000000a', 'a0000000-1111-4000-8000-000000000001',
    'a0000000-1111-4000-8000-00000000000a', 'growth-drops'),
  ('a0000000-4444-4000-8000-00000000000b', 'a0000000-1111-4000-8000-000000000001',
    'a0000000-1111-4000-8000-00000000000b', 'growth-drops');

-- connector_sync_runs / connector_health_snapshots / connector_audit_events:
-- one installation, then a per-store row plus a brand-wide one on each.
select id as provider_id from public.connector_registry limit 1 \gset
insert into public.connector_installations (id, brand_id, provider_id) values
  ('a0000000-5555-4000-8000-000000000001', 'a0000000-1111-4000-8000-000000000001',
    :'provider_id');
insert into public.connector_sync_runs
  (id, brand_id, installation_id, location_id, capability_key, direction, trigger_kind,
   correlation_id, idempotency_key)
values
  ('a0000000-6666-4000-8000-00000000000a', 'a0000000-1111-4000-8000-000000000001',
    'a0000000-5555-4000-8000-000000000001', 'a0000000-1111-4000-8000-00000000000a',
    'orders.sync', 'import', 'manual', gen_random_uuid(), 'idem-store-a-run'),
  ('a0000000-6666-4000-8000-00000000000b', 'a0000000-1111-4000-8000-000000000001',
    'a0000000-5555-4000-8000-000000000001', 'a0000000-1111-4000-8000-00000000000b',
    'orders.sync', 'import', 'manual', gen_random_uuid(), 'idem-store-b-run'),
  ('a0000000-6666-4000-8000-000000000000', 'a0000000-1111-4000-8000-000000000001',
    'a0000000-5555-4000-8000-000000000001', null,
    'orders.sync', 'import', 'manual', gen_random_uuid(), 'idem-brand-run');
insert into public.connector_health_snapshots (id, brand_id, installation_id, location_id, status) values
  ('a0000000-7777-4000-8000-00000000000a', 'a0000000-1111-4000-8000-000000000001',
    'a0000000-5555-4000-8000-000000000001', 'a0000000-1111-4000-8000-00000000000a', 'healthy'),
  ('a0000000-7777-4000-8000-00000000000b', 'a0000000-1111-4000-8000-000000000001',
    'a0000000-5555-4000-8000-000000000001', 'a0000000-1111-4000-8000-00000000000b', 'healthy'),
  ('a0000000-7777-4000-8000-000000000000', 'a0000000-1111-4000-8000-000000000001',
    'a0000000-5555-4000-8000-000000000001', null, 'healthy');
insert into public.connector_audit_events
  (id, brand_id, installation_id, location_id, action, outcome, correlation_id, source)
values
  ('a0000000-8888-4000-8000-00000000000a', 'a0000000-1111-4000-8000-000000000001',
    'a0000000-5555-4000-8000-000000000001', 'a0000000-1111-4000-8000-00000000000a',
    'connector.sync', 'success', gen_random_uuid(), 'system'),
  ('a0000000-8888-4000-8000-00000000000b', 'a0000000-1111-4000-8000-000000000001',
    'a0000000-5555-4000-8000-000000000001', 'a0000000-1111-4000-8000-00000000000b',
    'connector.sync', 'success', gen_random_uuid(), 'system'),
  ('a0000000-8888-4000-8000-000000000000', 'a0000000-1111-4000-8000-000000000001',
    'a0000000-5555-4000-8000-000000000001', null,
    'connector.sync', 'success', gen_random_uuid(), 'system');

-- A location_manager scoped to store A: sees store A and brand-wide rows,
-- never store B, on every one of the six tables the drift affected.
set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object(
  'role', 'authenticated',
  'app_metadata', jsonb_build_object(
    'brand_id', 'a0000000-1111-4000-8000-000000000001',
    'role', 'location_manager',
    'location_ids', jsonb_build_array('a0000000-1111-4000-8000-00000000000a')
  )
)::text, true);

select set_eq(
  $$select id from public.crew_tasks$$,
  array['a0000000-2222-4000-8000-00000000000a', 'a0000000-2222-4000-8000-000000000000']::uuid[],
  'crew_tasks: manager at store A sees store A + the brand-wide task, never store B');
select set_eq(
  $$select id from public.workforce_role_assignments$$,
  array['a0000000-3333-4000-8000-00000000000a', 'a0000000-3333-4000-8000-000000000000']::uuid[],
  'workforce_role_assignments: manager at store A sees store A + brand-wide, never store B');
select set_eq(
  $$select id from public.site_module_overrides$$,
  array['a0000000-4444-4000-8000-00000000000a']::uuid[],
  'site_module_overrides: manager at store A sees only store A''s override');
select set_eq(
  $$select id from public.connector_sync_runs$$,
  array['a0000000-6666-4000-8000-00000000000a', 'a0000000-6666-4000-8000-000000000000']::uuid[],
  'connector_sync_runs: manager at store A sees store A + brand-wide runs, never store B');
select set_eq(
  $$select id from public.connector_health_snapshots$$,
  array['a0000000-7777-4000-8000-00000000000a', 'a0000000-7777-4000-8000-000000000000']::uuid[],
  'connector_health_snapshots: manager at store A sees store A + brand-wide, never store B');
select set_eq(
  $$select id from public.connector_audit_events$$,
  array['a0000000-8888-4000-8000-00000000000a', 'a0000000-8888-4000-8000-000000000000']::uuid[],
  'connector_audit_events: manager at store A sees store A + brand-wide, never store B');

-- The manager's own write scope: one statement touching both stores updates
-- only the one they manage -- proving the fix admits a legitimate manager
-- write to their own store while still refusing the other store's.
-- pgtap's set_eq/is_empty wrap the given SQL in `create temp table ... as
-- (sql)`, which only accepts a SELECT-shaped statement; a data-modifying CTE
-- makes an UPDATE ... RETURNING select-shaped so it can be wrapped the same
-- way.
select set_eq(
  $$with touched as (
      update public.locations set name = name || ' (touched)'
        where id in ('a0000000-1111-4000-8000-00000000000a', 'a0000000-1111-4000-8000-00000000000b')
        returning id
    ) select id from touched$$,
  array['a0000000-1111-4000-8000-00000000000a']::uuid[],
  'locations_update: a location_manager updates their own store, never the other one');

-- Staff at store A: the drift named 'staff' explicitly for crew_tasks --
-- confirm the fix keeps their own store's (and the brand-wide) work visible.
select set_config('request.jwt.claims', jsonb_build_object(
  'role', 'authenticated',
  'app_metadata', jsonb_build_object(
    'brand_id', 'a0000000-1111-4000-8000-000000000001',
    'role', 'staff',
    'location_ids', jsonb_build_array('a0000000-1111-4000-8000-00000000000a')
  )
)::text, true);
select set_eq(
  $$select id from public.crew_tasks$$,
  array['a0000000-2222-4000-8000-00000000000a', 'a0000000-2222-4000-8000-000000000000']::uuid[],
  'crew_tasks: staff at store A still sees store A + brand-wide after the fix');

-- Staff cannot update a location at all, their own store included --
-- app.manages_location's role check is 'location_manager' only.
select is_empty(
  $$with touched as (
      update public.locations set name = name || ' (touched)'
        where id in ('a0000000-1111-4000-8000-00000000000a', 'a0000000-1111-4000-8000-00000000000b')
        returning id
    ) select id from touched$$,
  'locations_update: staff cannot update any location, their own store included');

reset role;
select * from finish();
rollback;
