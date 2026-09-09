begin;
create extension if not exists pgtap with schema extensions;
set search_path = extensions, public, pg_catalog;
select plan(17);
create temp table test_module_payloads (key text primary key, modules jsonb not null);
insert into test_module_payloads values
('construction', '[{"key":"construction-projects","version":"1.0.0","enabled":true,"config":{},"surfaces":["operator","hq"]},{"key":"workforce-operations","version":"1.0.0","enabled":true,"config":{},"surfaces":["operator","hq"]},{"key":"workforce-training","version":"1.0.0","enabled":true,"config":{},"surfaces":["operator","hq"]},{"key":"commerce-catalog","version":"1.0.0","enabled":true,"config":{},"surfaces":["customer","kiosk","operator","hq"]},{"key":"commerce-ordering","version":"1.0.0","enabled":true,"config":{},"surfaces":["customer","kiosk","operator","display","hq"]},{"key":"commerce-payments","version":"1.0.0","enabled":true,"config":{},"surfaces":["customer","kiosk","operator","hq"]},{"key":"local-printing","version":"1.0.0","enabled":true,"config":{},"surfaces":["kiosk","operator","hq"]},{"key":"device-wall","version":"1.0.0","enabled":true,"config":{},"surfaces":["operator","kiosk","display"]}]'),
('all-five', '[{"key":"commerce-ordering","version":"1.0.0","enabled":true,"config":{},"surfaces":["hq","display","customer","operator","kiosk"]}]');
grant select on test_module_payloads to authenticated, service_role;
insert into auth.users (id,email,raw_app_meta_data,raw_user_meta_data) values
('11111111-1111-4111-8111-111111111111','platform@example.test','{}','{}'),
('22222222-2222-4222-8222-222222222222','owner@example.test','{}','{}'),
('66666666-6666-4666-8666-666666666666','franchisee@example.test','{}','{}');
insert into public.brands (id,slug,name) values
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','audit-platform','Audit Platform');
insert into public.brands (id,slug,name,status) values
('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','ledgerless-tenant','Ledgerless Tenant','provisioning');
insert into public.brand_users (user_id,brand_id,role) values
('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','platform_admin'),
('11111111-1111-4111-8111-111111111111','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','platform_admin');
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object(
  'sub','11111111-1111-4111-8111-111111111111','role','authenticated',
  'app_metadata',jsonb_build_object('role','platform_admin',
    'brand_id','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','location_ids',jsonb_build_array())
)::text,true);
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
do $fixture$begin
  perform public.provision_platform_organization(
    '33333333-3333-4333-8333-333333333333','Stillpoint Audit','stillpoint-audit',
    '22222222-2222-4222-8222-222222222222','owner@example.test',
    'franchisor','construction','construction','{"identity":{"name":"Stillpoint Audit"}}',
    null,(select modules from test_module_payloads where key='construction'));
end$fixture$;
select is(public.enroll_brand_in_network(
  (select id from public.franchise_networks where slug = 'stillpoint-audit'),
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), true,
  'platform enrollment opens a consent-pending request');
select is((select status from public.franchise_network_brands
  where brand_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), 'pending'::text,
  'generic enrollment remains pending until the brand owner accepts');
select is((select status from public.franchise_agreements
  where franchisee_brand_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), 'pending'::text,
  'generic enrollment creates its pending agreement atomically');
reset role;
set local role service_role;
insert into public.brand_users (user_id, brand_id, role) values
  ('66666666-6666-4666-8666-666666666666',
   'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'brand_owner');
delete from public.franchise_agreements
where franchisee_brand_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
reset role;
set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object(
  'sub','66666666-6666-4666-8666-666666666666','role','authenticated',
  'app_metadata',jsonb_build_object('role','brand_owner',
    'brand_id','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','location_ids',jsonb_build_array())
)::text, true);
select set_config('request.jwt.claim.sub', '66666666-6666-4666-8666-666666666666', true);
select throws_ok($test$
  select public.respond_to_network_enrollment(
    (select id from public.franchise_networks where slug = 'stillpoint-audit'),
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', true)
$test$, '23503', 'pending_agreement_not_found',
  'acceptance fails closed when the pending agreement is missing');
reset role;
set local role service_role;
select is((select status from public.franchise_network_brands
  where brand_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), 'pending'::text,
  'failed agreement acceptance leaves membership pending');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object(
  'sub','11111111-1111-4111-8111-111111111111','role','authenticated',
  'app_metadata',jsonb_build_object('role','platform_admin',
    'brand_id','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','location_ids',jsonb_build_array())
)::text, true);
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select public.enroll_brand_in_network(
  (select id from public.franchise_networks where slug = 'stillpoint-audit'),
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
select is((select count(*) from public.franchise_agreements
  where franchisee_brand_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    and status = 'pending'), 1::bigint,
  're-enrollment restores exactly one pending agreement');
select throws_ok($test$
  select public.provision_platform_organization(
    '77777777-7777-4777-8777-777777777777','Mismatched Blueprint','mismatched-blueprint',
    '66666666-6666-4666-8666-666666666666','franchisee@example.test',
    'operator','construction','coffee-shop','{}',null,'[]')
$test$, '22023', 'invalid_organization_provisioning_request',
  'an industry cannot be paired with a different blueprint');
select lives_ok($test$
  select public.provision_platform_organization(
    '99999999-9999-4999-8999-999999999999','Blank Operator','blank-operator',
    '66666666-6666-4666-8666-666666666666','franchisee@example.test',
    'operator','general','blank','{}',null,'[]')
$test$, 'the general industry provisions through its explicit blank blueprint');
select lives_ok($test$
  select public.provision_platform_organization(
    '55555555-5555-4555-8555-555555555555','Stillpoint Denver','stillpoint-denver',
    '66666666-6666-4666-8666-666666666666','franchisee@example.test',
    'franchisee','construction','construction','{"identity":{"name":"Stillpoint Denver"}}',
    '{"name":"Denver","address":{},"hours":{},"timezone":"America/Denver"}',
    (select modules from test_module_payloads where key = 'construction'),'stillpoint-audit')
$test$, 'a franchisee provisions into a consent-pending relationship');
select is((select member_brand.status from public.franchise_network_brands member_brand
  join public.brands brand on brand.id = member_brand.brand_id
  where brand.slug = 'stillpoint-denver'), 'pending'::text,
  'the franchisee network membership awaits owner consent');
select is((select agreement.status from public.franchise_agreements agreement
  join public.brands brand on brand.id = agreement.franchisee_brand_id
  where brand.slug = 'stillpoint-denver'), 'pending'::text,
  'the franchise agreement awaits owner consent');
reset role;
update public.organization_readiness_checks set
  status = 'passed', checked_at = now(), evidence = '{"test":"ready"}'
where brand_id = (select id from public.brands where slug = 'stillpoint-denver')
  and required;
update public.organization_provisioning_runs set stage = 'ready'
where brand_id = (select id from public.brands where slug = 'stillpoint-denver');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object(
  'sub','11111111-1111-4111-8111-111111111111','role','authenticated',
  'app_metadata',jsonb_build_object('role','platform_admin',
    'brand_id','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','location_ids',jsonb_build_array())
)::text, true);
select throws_ok($test$
  select public.activate_platform_organization(
    (select id from public.brands where slug = 'stillpoint-denver'))
$test$, '23514', 'organization_not_ready',
  'a franchisee cannot activate before membership and agreement consent');
select set_config('test.franchisee_brand_id',
  (select id::text from public.brands where slug = 'stillpoint-denver'), true);
select set_config('test.network_id',
  (select id::text from public.franchise_networks where slug = 'stillpoint-audit'), true);
select set_config('request.jwt.claims', jsonb_build_object(
  'sub','66666666-6666-4666-8666-666666666666','role','authenticated',
  'app_metadata',jsonb_build_object('role','brand_owner',
    'brand_id',current_setting('test.franchisee_brand_id'),'location_ids',jsonb_build_array())
)::text, true);
select set_config('request.jwt.claim.sub', '66666666-6666-4666-8666-666666666666', true);
select is(public.respond_to_network_enrollment(
  current_setting('test.network_id')::uuid,
  current_setting('test.franchisee_brand_id')::uuid, true),
  'active'::text, 'the franchisee owner accepts the network enrollment');
reset role;
set local role service_role;
select is((select member_brand.status from public.franchise_network_brands member_brand
  where member_brand.brand_id = current_setting('test.franchisee_brand_id')::uuid), 'active'::text,
  'owner consent activates network membership');
select is((select agreement.status from public.franchise_agreements agreement
  where agreement.franchisee_brand_id = current_setting('test.franchisee_brand_id')::uuid
    and agreement.accepted_by = '66666666-6666-4666-8666-666666666666'), 'active'::text,
  'owner consent activates the agreement with durable attribution');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object(
  'sub','11111111-1111-4111-8111-111111111111','role','authenticated',
  'app_metadata',jsonb_build_object('role','platform_admin',
    'brand_id','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','location_ids',jsonb_build_array())
)::text, true);
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select lives_ok($test$
  select public.activate_platform_organization(
    (select id from public.brands where slug = 'stillpoint-denver'))
$test$, 'a consented and ready franchisee can activate');

reset role;
set local role service_role;
select is(public.reconcile_brand_modules(
  (select id from public.brands where slug = 'stillpoint-audit'),
  (select modules from test_module_payloads where key = 'construction')),
  0::integer, 'surface-aware reconciliation is idempotent');
reset role;
select * from finish();
rollback;
