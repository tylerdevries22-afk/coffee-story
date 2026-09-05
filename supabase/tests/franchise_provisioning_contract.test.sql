begin;
create extension if not exists pgtap with schema extensions;
set search_path = extensions, public, pg_catalog;
select plan(68);

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
set local role service_role;
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
select throws_ok($test$
  select public.reconcile_brand_modules(
    (select id from public.brands where slug = 'stillpoint-audit'),
    '[{"key":"construction-projects","version":"1.0.0","surfaces":["customer"]}]')
$test$, '22023', 'module_surfaces_not_supported',
  'a module cannot exceed its registered surfaces');

reset role;
set local role authenticated;
select lives_ok($test$
  select public.provision_platform_organization(
    '44444444-4444-4444-8444-444444444444','Five Surface Audit','five-surface-audit',
    '22222222-2222-4222-8222-222222222222','owner@example.test',
    'operator','coffee-shop','coffee-shop','{}',null,
    (select modules from test_module_payloads where key = 'all-five'))
$test$, 'a registered module may use all five surfaces');
select is((select installation.surfaces from public.module_installations installation
  join public.brands brand on brand.id = installation.brand_id
  where brand.slug = 'five-surface-audit'),
  array['customer','kiosk','operator','display','hq']::text[],
  'all five surfaces are canonical and durable');
select is((select run.request->'applicationSurfaces' from public.organization_provisioning_runs run
  join public.brands brand on brand.id = run.brand_id where brand.slug = 'five-surface-audit'),
  '["hq","display","customer","operator","kiosk"]'::jsonb,
  'the full deployment matrix is recorded');

reset role;
set local role service_role;
update public.organization_readiness_checks set
  status = 'passed', checked_at = now(), evidence = '{"test":"ready"}'
where brand_id = (select id from public.brands where slug = 'five-surface-audit')
  and required;
update public.organization_provisioning_runs set stage = 'ready'
where brand_id = (select id from public.brands where slug = 'five-surface-audit');
select lives_ok($test$
  select public.record_organization_readiness(
    (select id from public.brands where slug = 'five-surface-audit'),
    'payment_provider', false, '{"providerReference":"stripe:not-required"}')
$test$, 'an optional readiness failure can be recorded');
select is((select run.stage from public.organization_provisioning_runs run
  join public.brands brand on brand.id = run.brand_id where brand.slug = 'five-surface-audit'),
  'ready'::text, 'an optional failed check does not regress required readiness');
select throws_ok($test$
  select public.record_organization_readiness(
    (select id from public.brands where slug = 'stillpoint-audit'),'tenant_artifacts',true,
    '{"artifactDigest":""}')
$test$, '22023', 'immutable_readiness_evidence_required',
  'empty artifact evidence is rejected');
select throws_ok($test$
  select public.record_organization_readiness(
    (select id from public.brands where slug = 'stillpoint-audit'),'release_approval',true,
    '{"commitSha":"not-a-commit"}')
$test$, '22023', 'immutable_readiness_evidence_required',
  'malformed commit evidence is rejected');
select throws_ok($test$
  select public.record_organization_readiness(
    (select id from public.brands where slug = 'stillpoint-audit'),'release_approval',true,
    '{"commitSha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}')
$test$, '22023', 'immutable_readiness_evidence_required',
  'release evidence without a content digest and provider reference is rejected');
select throws_ok($test$
  select public.record_organization_readiness(
    (select id from public.brands where slug = 'stillpoint-audit'),'payment_provider',true,
    '{"providerReference":""}')
$test$, '22023', 'immutable_readiness_evidence_required',
  'empty provider evidence is rejected');
select lives_ok($test$
  select public.record_organization_readiness(
    (select id from public.brands where slug = 'stillpoint-audit'),'tenant_artifacts',true,
    '{"artifactDigest":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}')
$test$, 'artifact evidence can be attached');
select lives_ok($test$
  select public.record_organization_readiness(
    (select id from public.brands where slug = 'stillpoint-audit'),'release_approval',true,
    '{"commitSha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","artifactDigest":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","providerReference":"vercel:production-a"}')
$test$, 'release evidence can be attached');
select is((select run.stage from public.organization_provisioning_runs run join public.brands brand
  on brand.id = run.brand_id where brand.slug = 'stillpoint-audit'),
  'awaiting_external'::text, 'payments keep the construction tenant blocked without provider evidence');
select lives_ok($test$
  select public.record_organization_readiness(
    (select id from public.brands where slug = 'stillpoint-audit'),'payment_provider',true,
    '{"providerReference":"stripe:test-readiness-evidence"}')
$test$, 'payment provider evidence can be attached');
select is((select run.stage from public.organization_provisioning_runs run join public.brands brand
  on brand.id = run.brand_id where brand.slug = 'stillpoint-audit'),
  'ready'::text, 'all module-derived required evidence advances the run');
select lives_ok($test$
  select public.record_organization_readiness(
    (select id from public.brands where slug = 'stillpoint-audit'),'tenant_artifacts',true,
    '{"artifactDigest":"sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}')
$test$, 'a newer content release can replace tenant artifact evidence');
select is((select status from public.organization_readiness_checks
  where brand_id = (select id from public.brands where slug = 'stillpoint-audit')
    and check_key = 'release_approval'), 'pending'::text,
  'new content invalidates approval for the prior digest');
select is((select run.stage from public.organization_provisioning_runs run join public.brands brand
  on brand.id = run.brand_id where brand.slug = 'stillpoint-audit'),
  'awaiting_external'::text, 'a digest change blocks activation until that release is approved');
select lives_ok($test$
  select public.record_organization_readiness(
    (select id from public.brands where slug = 'stillpoint-audit'),'release_approval',true,
    '{"commitSha":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","artifactDigest":"sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","providerReference":"vercel:production-b"}')
$test$, 'release approval can be recorded for the replacement digest');
select is((select run.stage from public.organization_provisioning_runs run join public.brands brand
  on brand.id = run.brand_id where brand.slug = 'stillpoint-audit'),
  'ready'::text, 'matching replacement evidence restores readiness');

reset role;
set local role authenticated;
select throws_ok($test$select public.activate_platform_organization(
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')$test$, '23514', 'organization_not_ready',
  'a tenant without a readiness ledger cannot activate');
select lives_ok($test$select public.activate_platform_organization(
  (select id from public.brands where slug = 'stillpoint-audit'))$test$,
  'a platform administrator activates a ready tenant');
select is((select status from public.brands where slug = 'stillpoint-audit'),
  'active'::text, 'activation opens the tenant');

reset role;
set local role anon;
select is((select array_agg(module_key order by module_key)
  from public.brand_storefront_capabilities('stillpoint-audit')),
  array['commerce-catalog','commerce-ordering','commerce-payments']::text[],
  'guests see only Stillpoint commerce capabilities');
reset role;
set local role service_role;
select lives_ok('select app.assert_franchise_provisioning_contract()',
  'the release-time contract assertion passes');

select * from finish();
rollback;
