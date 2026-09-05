begin;
create extension if not exists pgtap with schema extensions;
set search_path = extensions, public, pg_catalog;
select plan(24);

select has_table('public', 'knowledge_acknowledgements',
  'knowledge acknowledgements have a normalized ledger');
select has_function('public', 'acknowledge_knowledge_resource', array['uuid'],
  'the caller-bound acknowledgement RPC exists');
select ok((select relrowsecurity from pg_class
  where oid = 'public.knowledge_acknowledgements'::regclass),
  'the acknowledgement ledger has RLS enabled');
select ok(has_table_privilege('authenticated', 'public.knowledge_acknowledgements', 'SELECT'),
  'authenticated callers can read their permitted acknowledgement rows');
select ok(not has_table_privilege('authenticated', 'public.knowledge_acknowledgements',
  'INSERT,UPDATE,DELETE'), 'authenticated callers have no direct write grant');
select ok(not has_table_privilege('anon', 'public.knowledge_acknowledgements',
  'SELECT,INSERT,UPDATE,DELETE'), 'anonymous callers have no ledger access');

insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'owner@knowledge.test'),
  ('22222222-2222-4222-8222-222222222222', 'manager@knowledge.test'),
  ('33333333-3333-4333-8333-333333333333', 'staff@knowledge.test'),
  ('44444444-4444-4444-8444-444444444444', 'other@knowledge.test');
insert into public.brands (id, slug, name) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'knowledge-a', 'Knowledge A'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'knowledge-b', 'Knowledge B');
insert into public.locations (id, brand_id, name) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'North'),
  ('aaaaaaaa-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'South'),
  ('bbbbbbbb-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Other');
insert into public.brand_users (id, user_id, brand_id, role, location_ids) values
  ('11111111-aaaa-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'brand_owner', '{}'),
  ('22222222-aaaa-4222-8222-222222222222', '22222222-2222-4222-8222-222222222222',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'location_manager',
    array['aaaaaaaa-0000-4000-8000-000000000002'::uuid]),
  ('33333333-aaaa-4333-8333-333333333333', '33333333-3333-4333-8333-333333333333',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'staff',
    array['aaaaaaaa-0000-4000-8000-000000000001'::uuid]),
  ('44444444-bbbb-4444-8444-444444444444', '44444444-4444-4444-8444-444444444444',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'staff',
    array['bbbbbbbb-0000-4000-8000-000000000001'::uuid]);
insert into public.workforce_roles (id, brand_id, slug, name) values
  ('aaaaaaaa-1000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'field-crew', 'Field crew');
insert into public.workforce_role_assignments (
  brand_id, brand_user_id, workforce_role_id, location_id
) values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '33333333-aaaa-4333-8333-333333333333',
  'aaaaaaaa-1000-4000-8000-000000000001',
  'aaaaaaaa-0000-4000-8000-000000000001'
);
insert into public.menus (id, brand_id, name) values
  ('aaaaaaaa-2000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'Knowledge catalog');
insert into public.catalogs (id, brand_id, name) values
  ('aaaaaaaa-2000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'Knowledge catalog');
insert into public.catalog_resources (
  id, brand_id, catalog_id, kind, slug, title, audience, metadata
) values
  ('aaaaaaaa-3000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'aaaaaaaa-2000-4000-8000-000000000001', 'knowledge', 'north-field', 'North field manual',
    'staff', '{"knowledge":{"documentType":"safety_manual","status":"approved","version":"2.0","locationIds":["aaaaaaaa-0000-4000-8000-000000000001"],"roleTargets":["Field crew"]}}'),
  ('aaaaaaaa-3000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'aaaaaaaa-2000-4000-8000-000000000001', 'knowledge', 'south-field', 'South field manual',
    'staff', '{"knowledge":{"documentType":"safety_manual","status":"approved","version":"1.0","locationIds":["aaaaaaaa-0000-4000-8000-000000000002"]}}'),
  ('aaaaaaaa-3000-4000-8000-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'aaaaaaaa-2000-4000-8000-000000000001', 'knowledge', 'draft-field', 'Draft field manual',
    'staff', '{"knowledge":{"documentType":"sop","status":"draft","version":"1.0"}}'),
  ('aaaaaaaa-3000-4000-8000-000000000004', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'aaaaaaaa-2000-4000-8000-000000000001', 'knowledge', 'manager-manual', 'Manager manual',
    'manager', '{"knowledge":{"documentType":"sop","status":"approved","version":"1.0","locationIds":["aaaaaaaa-0000-4000-8000-000000000002"]}}'),
  ('aaaaaaaa-3000-4000-8000-000000000005', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'aaaaaaaa-2000-4000-8000-000000000001', 'knowledge', 'owner-manual', 'Owner manual',
    'owner', '{"knowledge":{"documentType":"sop","status":"approved","version":"1.0","locationIds":["aaaaaaaa-0000-4000-8000-000000000002"]}}');

set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', '33333333-3333-4333-8333-333333333333', 'role', 'authenticated',
  'app_metadata', jsonb_build_object('role', 'staff',
    'brand_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'location_ids', jsonb_build_array('aaaaaaaa-0000-4000-8000-000000000001'))
)::text, true);
select results_eq($test$select title from public.catalog_resources order by title$test$,
  array['North field manual']::text[],
  'staff read only approved knowledge targeted to their role and location');
select results_eq($test$
  select acknowledged_version from public.acknowledge_knowledge_resource(
    'aaaaaaaa-3000-4000-8000-000000000001')
$test$, array['2.0']::text[], 'staff acknowledge an eligible current version');
select lives_ok($test$
  select public.acknowledge_knowledge_resource('aaaaaaaa-3000-4000-8000-000000000001')
$test$, 'repeated acknowledgement is idempotent');
reset role;
select is((select count(*) from public.knowledge_acknowledgements
  where resource_id = 'aaaaaaaa-3000-4000-8000-000000000001'), 1::bigint,
  'an idempotent retry writes one acknowledgement row');
set local role authenticated;
select throws_ok($test$
  insert into public.knowledge_acknowledgements (
    brand_id, resource_id, user_id, resource_version
  ) values (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'aaaaaaaa-3000-4000-8000-000000000001',
    '33333333-3333-4333-8333-333333333333', '3.0')
$test$, '42501', null, 'staff cannot bypass the RPC with a direct insert');
select throws_ok($test$update public.knowledge_acknowledgements
  set resource_version = '3.0'$test$, '42501', null,
  'staff cannot update acknowledgement history');
select throws_ok($test$delete from public.knowledge_acknowledgements$test$,
  '42501', null, 'staff cannot delete acknowledgement history');

select set_config('request.jwt.claims', jsonb_build_object(
  'sub', '44444444-4444-4444-8444-444444444444', 'role', 'authenticated',
  'app_metadata', jsonb_build_object('role', 'staff',
    'brand_id', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'location_ids', jsonb_build_array('bbbbbbbb-0000-4000-8000-000000000001'))
)::text, true);
select is_empty($test$select id from public.catalog_resources$test$,
  'another tenant cannot read knowledge resources');
select throws_ok($test$select public.acknowledge_knowledge_resource(
  'aaaaaaaa-3000-4000-8000-000000000001')$test$,
  '42501', 'knowledge_access_denied', 'another tenant cannot acknowledge a resource');

select set_config('request.jwt.claims', jsonb_build_object(
  'sub', '22222222-2222-4222-8222-222222222222', 'role', 'authenticated',
  'app_metadata', jsonb_build_object('role', 'location_manager',
    'brand_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'location_ids', jsonb_build_array('aaaaaaaa-0000-4000-8000-000000000002'))
)::text, true);
select results_eq($test$select title from public.catalog_resources order by title$test$,
  array['Manager manual','South field manual']::text[],
  'a manager reads approved knowledge for their audience and location');

select set_config('request.jwt.claims', jsonb_build_object(
  'sub', '11111111-1111-4111-8111-111111111111', 'role', 'authenticated',
  'app_metadata', jsonb_build_object('role', 'brand_owner',
    'brand_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'location_ids', jsonb_build_array())
)::text, true);
select is((select count(*) from public.catalog_resources), 5::bigint,
  'a brand owner reads every document lifecycle state');
select results_eq($test$update public.catalog_resources
  set metadata = jsonb_set(metadata, '{knowledge,status}', '"in_review"')
  where id = 'aaaaaaaa-3000-4000-8000-000000000003'
  returning metadata #>> '{knowledge,status}'$test$,
  array['in_review']::text[], 'a brand owner may manage document metadata');
select results_eq($test$select acknowledged_version
  from public.acknowledge_knowledge_resource('aaaaaaaa-3000-4000-8000-000000000005')$test$,
  array['1.0']::text[],
  'an owner has brand-wide audience and location access when no role target exists');
select throws_ok($test$select public.acknowledge_knowledge_resource(
  'aaaaaaaa-3000-4000-8000-000000000001')$test$,
  '42501', 'knowledge_access_denied',
  'an owner still respects an explicit workforce role target when acknowledging');
select throws_ok($test$update public.catalog_resources set metadata = jsonb_set(
  metadata, '{knowledge,acknowledgedUserIds}', '["11111111-1111-4111-8111-111111111111"]')
  where id = 'aaaaaaaa-3000-4000-8000-000000000003'$test$,
  '23514', null, 'catalog metadata cannot regain embedded acknowledgement arrays');

reset role;
select throws_ok($test$update public.knowledge_acknowledgements
  set acknowledged_at = now()$test$, '55000', 'record_is_append_only',
  'even a privileged writer cannot rewrite acknowledgement history');
select throws_ok($test$delete from public.knowledge_acknowledgements$test$,
  '55000', 'record_is_append_only',
  'even a privileged writer cannot delete acknowledgement history');
select lives_ok('select app.assert_knowledge_acknowledgements()',
  'the release-time knowledge acknowledgement assertion passes');

select * from finish();
rollback;
