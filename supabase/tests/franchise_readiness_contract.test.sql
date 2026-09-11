begin;
create extension if not exists pgtap with schema extensions;
set search_path = extensions, public, pg_catalog;
select plan(25);
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
reset role;
set local role service_role;
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
update public.organization_readiness_checks set
  status = 'passed', checked_at = now(), evidence = '{"test":"ready"}'
where brand_id = (select id from public.brands where slug = 'five-surface-audit')
  and required;
update public.organization_provisioning_runs set stage = 'ready'
where brand_id = (select id from public.brands where slug = 'five-surface-audit');
set local role service_role;
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
