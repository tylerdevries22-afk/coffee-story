begin;
create extension if not exists pgtap with schema extensions;
set search_path = extensions, public, pg_catalog;
select plan(26);

select has_table('public', 'organization_provisioning_runs', 'provisioning has a run ledger');
select has_table('public', 'organization_readiness_checks', 'readiness is explicit');
select has_column('public', 'module_installations', 'surfaces', 'module surfaces are durable');
select has_function('public', 'provision_platform_organization', array[
  'uuid','text','text','uuid','text','text','text','text','jsonb','jsonb','jsonb',
  'text','jsonb','jsonb','integer','integer','bigint'
], 'the atomic provisioning RPC exists');
select has_function('public', 'provision_platform_organization_with_connectors', array[
  'uuid','text','text','uuid','text','text','text','text','jsonb','jsonb','jsonb',
  'text','jsonb','jsonb','jsonb','integer','integer','bigint'
], 'the connector-aware atomic provisioning RPC exists');
select ok(not has_table_privilege('authenticated', 'public.module_installations', 'UPDATE'),
  'authenticated clients cannot rewrite module surfaces');
select is((select count(*) from public.industry_blueprints
  where industry_key = 'construction' and version = 1 and status = 'active'),
  1::bigint, 'the construction blueprint is available');
select is((select manifest->'applicationSurfaces' from public.industry_blueprints
  where industry_key = 'construction' and version = 1),
  '["hq","display","customer","operator","kiosk"]'::jsonb,
  'construction can ship all five tenant-driven applications');
select is((select manifest->'applicationSurfaces' from public.industry_blueprints
  where industry_key = 'coffee-shop' and version = 1),
  '["hq","display","customer","operator","kiosk"]'::jsonb,
  'all five platform surfaces can be declared');
select is((select manifest->>'key' from public.industry_blueprints
  where industry_key = 'general' and version = 1 and status = 'active'),
  'blank'::text, 'the general industry resolves to the blank blueprint');

create temp table test_module_payloads (key text primary key, modules jsonb not null);
insert into test_module_payloads values
('construction', '[{"key":"construction-projects","version":"1.0.0","enabled":true,"config":{},"surfaces":["operator","hq"]},{"key":"workforce-operations","version":"1.0.0","enabled":true,"config":{},"surfaces":["operator","hq"]},{"key":"workforce-training","version":"1.0.0","enabled":true,"config":{},"surfaces":["operator","hq"]},{"key":"commerce-catalog","version":"1.0.0","enabled":true,"config":{},"surfaces":["customer","kiosk","operator","hq"]},{"key":"commerce-ordering","version":"1.0.0","enabled":true,"config":{},"surfaces":["customer","kiosk","operator","display","hq"]},{"key":"commerce-payments","version":"1.0.0","enabled":true,"config":{},"surfaces":["customer","kiosk","operator","hq"]},{"key":"local-printing","version":"1.0.0","enabled":true,"config":{},"surfaces":["kiosk","operator","hq"]},{"key":"device-wall","version":"1.0.0","enabled":true,"config":{},"surfaces":["operator","kiosk","display"]}]'),
('all-five', '[{"key":"commerce-ordering","version":"1.0.0","enabled":true,"config":{},"surfaces":["hq","display","customer","operator","kiosk"]}]');
grant select on test_module_payloads to authenticated, service_role;
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
('11111111-1111-4111-8111-111111111111','platform@example.test','{}','{}'),
('22222222-2222-4222-8222-222222222222','owner@example.test','{}','{}'),
('66666666-6666-4666-8666-666666666666','franchisee@example.test','{}','{}');
insert into public.brands (id, slug, name) values
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','audit-platform','Audit Platform');
insert into public.brands (id, slug, name, status) values
('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','ledgerless-tenant','Ledgerless Tenant','provisioning');
insert into public.brand_users (user_id, brand_id, role) values
('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','platform_admin'),
('11111111-1111-4111-8111-111111111111','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','platform_admin');

set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object(
  'sub','11111111-1111-4111-8111-111111111111','role','authenticated',
  'app_metadata',jsonb_build_object('role','platform_admin',
    'brand_id','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','location_ids',jsonb_build_array())
)::text, true);
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select lives_ok($test$
  select public.provision_platform_organization_with_connectors(
    '34343434-3434-4434-8434-343434343434','MCP Audit','mcp-audit',
    '22222222-2222-4222-8222-222222222222','owner@example.test',
    'operator','general','blank','{}',null,'[]',null,'{}','{}',
    '["google-suite","quickbooks-online","square","slack"]')
$test$, 'an organization and its MCP selections provision atomically');
select is((select count(*) from public.connector_installations installation
  join public.brands brand on brand.id = installation.brand_id
  where brand.slug = 'mcp-audit'), 4::bigint,
  'selected MCPs become tenant-scoped setup installations');
select is((select count(*) from public.connector_audit_events event
  join public.brands brand on brand.id = event.brand_id
  where brand.slug = 'mcp-audit' and event.action = 'installation.selected'), 4::bigint,
  'MCP onboarding selections are audit logged');
select lives_ok($test$
  select public.provision_platform_organization_with_connectors(
    '34343434-3434-4434-8434-343434343434','MCP Audit','mcp-audit',
    '22222222-2222-4222-8222-222222222222','owner@example.test',
    'operator','general','blank','{}',null,'[]',null,'{}','{}',
    '["slack","square","quickbooks-online","google-suite"]')
$test$, 'connector provisioning replays safely regardless of selection order');
select throws_ok($test$
  select public.provision_platform_organization_with_connectors(
    '34343434-3434-4434-8434-343434343434','MCP Audit','mcp-audit',
    '22222222-2222-4222-8222-222222222222','owner@example.test',
    'operator','general','blank','{}',null,'[]',null,'{}','{}','["stripe"]')
$test$, '22023', 'idempotency_key_payload_mismatch',
  'a provisioning key rejects changed MCP selections');
select lives_ok($test$
  select public.provision_platform_organization(
    '33333333-3333-4333-8333-333333333333','Stillpoint Audit','stillpoint-audit',
    '22222222-2222-4222-8222-222222222222','owner@example.test',
    'franchisor','construction','construction','{"identity":{"name":"Stillpoint Audit"}}',
    null,(select modules from test_module_payloads where key = 'construction'))
$test$, 'Stillpoint provisions all requested construction modules');
select is((select count(*) from public.module_installations installation join public.brands brand
  on brand.id = installation.brand_id where brand.slug = 'stillpoint-audit'
  and installation.state = 'active'), 8::bigint, 'all construction modules are active');
select is((select count(distinct surface) from public.module_installations installation
  join public.brands brand on brand.id = installation.brand_id
  cross join lateral unnest(installation.surfaces) surface
  where brand.slug = 'stillpoint-audit'), 5::bigint,
  'the complete Stillpoint module set covers all five surfaces');
select is((select run.request->'applicationSurfaces' from public.organization_provisioning_runs run
  join public.brands brand on brand.id = run.brand_id where brand.slug = 'stillpoint-audit'),
  '["hq","display","customer","operator","kiosk"]'::jsonb,
  'the construction deployment matrix is recorded');
select lives_ok($test$
  select public.provision_platform_organization(
    '33333333-3333-4333-8333-333333333333','Stillpoint Audit','stillpoint-audit',
    '22222222-2222-4222-8222-222222222222','owner@example.test',
    'franchisor','construction','construction','{"identity":{"name":"Stillpoint Audit"}}',
    null,(select modules from test_module_payloads where key = 'construction'))
$test$, 'the same provisioning request replays safely');
select is((select count(*) from public.brands where slug = 'stillpoint-audit'),
  1::bigint, 'a replay does not duplicate the tenant');
select throws_ok($test$
  select public.provision_platform_organization(
    '33333333-3333-4333-8333-333333333333','Changed Name','stillpoint-audit',
    '22222222-2222-4222-8222-222222222222','owner@example.test',
    'franchisor','construction','construction','{}',null,'[]')
$test$, '22023', 'idempotency_key_payload_mismatch',
  'an idempotency key rejects a changed payload');
select lives_ok($test$
  select public.grant_delegated_access(
    (select id from public.franchise_networks where slug = 'stillpoint-audit'),
    (select id from public.brands where slug = 'stillpoint-audit'),
    '66666666-6666-4666-8666-666666666666', array['network:kpis'],
    now() + interval '1 day', '88888888-8888-4888-8888-888888888888')
$test$, 'a delegated grant accepts a stable idempotency key');
select is(public.grant_delegated_access(
  (select id from public.franchise_networks where slug = 'stillpoint-audit'),
  (select id from public.brands where slug = 'stillpoint-audit'),
  '66666666-6666-4666-8666-666666666666', array['network:kpis'],
  now() + interval '1 day', '88888888-8888-4888-8888-888888888888'),
  (select id from public.delegated_access_grants
    where idempotency_key = '88888888-8888-4888-8888-888888888888'),
  'a delegated grant replay returns the original row');
select throws_ok($test$
  select public.grant_delegated_access(
    (select id from public.franchise_networks where slug = 'stillpoint-audit'),
    (select id from public.brands where slug = 'stillpoint-audit'),
    '66666666-6666-4666-8666-666666666666', array['network:reports'],
    now() + interval '1 day', '88888888-8888-4888-8888-888888888888')
$test$, '22023', 'idempotency_key_payload_mismatch',
  'a delegated grant key cannot be replayed with a changed payload');
reset role;
set local role service_role;
insert into public.delegated_access_grants (
  brand_id, network_id, grantee_user_id, scope, created_by,
  expires_at, created_at, idempotency_key
) values (
  (select id from public.brands where slug = 'stillpoint-audit'),
  (select id from public.franchise_networks where slug = 'stillpoint-audit'),
  '66666666-6666-4666-8666-666666666666', array['network:kpis'],
  '11111111-1111-4111-8111-111111111111', now() - interval '1 day',
  now() - interval '2 days', '12121212-1212-4212-8212-121212121212'
);
reset role;
set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object(
  'sub','11111111-1111-4111-8111-111111111111','role','authenticated',
  'app_metadata',jsonb_build_object('role','platform_admin',
    'brand_id','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','location_ids',jsonb_build_array())
)::text, true);
select is(public.grant_delegated_access(
  (select id from public.franchise_networks where slug = 'stillpoint-audit'),
  (select id from public.brands where slug = 'stillpoint-audit'),
  '66666666-6666-4666-8666-666666666666', array['network:kpis'],
  now() - interval '1 day', '12121212-1212-4212-8212-121212121212'),
  (select id from public.delegated_access_grants
    where idempotency_key = '12121212-1212-4212-8212-121212121212'),
  'a delayed identical replay returns the original expired grant');
reset role;
select * from finish();
rollback;
