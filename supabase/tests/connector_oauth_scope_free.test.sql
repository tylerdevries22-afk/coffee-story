begin;
create extension if not exists pgtap with schema extensions;
set search_path = extensions, public, pg_catalog;
select plan(7);

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('11111111-cccc-4111-8111-111111111111', 'scope-free-owner@example.test', '{}', '{}');
insert into public.brands (id, slug, name) values
  ('22222222-cccc-4222-8222-222222222222', 'oauth-scope-free-test', 'Scope Free');
insert into public.brand_users (user_id, brand_id, role) values
  ('11111111-cccc-4111-8111-111111111111',
   '22222222-cccc-4222-8222-222222222222', 'brand_owner');
insert into public.connector_registry (
  id, provider_key, display_name, category, availability,
  logo_path, logo_source_url, logo_license, oauth_lifecycle_managed,
  oauth_refresh_managed, oauth_revocation_scope, oauth_grant_namespace
) values ('33333333-cccc-4333-8333-333333333333', 'oauth-scope-free-test',
  'Scope Free', 'platform', 'available', '/test.svg',
  'https://example.test/logo.svg', 'test', true, false, 'credential',
  'oauth-scope-free-test');
insert into public.connector_capabilities (
  id, provider_id, capability_key, display_name, access_mode, oauth_scopes
) values ('44444444-cccc-4444-8444-444444444444',
  '33333333-cccc-4333-8333-333333333333',
  'account.health', 'Account health', 'health', '{}');
insert into public.connector_certifications (
  capability_id, environment, status, contract_version, certified_at, valid_until
) values ('44444444-cccc-4444-8444-444444444444', 'sandbox', 'passed',
  '1.0.0', now(), now() + interval '1 day');

select lives_ok($test$select public.begin_connector_oauth_state(
  '22222222-cccc-4222-8222-222222222222', 'oauth-scope-free-test',
  '11111111-cccc-4111-8111-111111111111', repeat('a',64), repeat('b',64),
  array[]::text[], 'https://hq.example.test/oauth-scope-free-test/callback',
  now() + interval '10 minutes')$test$, 'scope-free provider can begin OAuth');
select is((select count(*) from public.consume_connector_oauth_state(
  'oauth-scope-free-test', '11111111-cccc-4111-8111-111111111111', repeat('a',64),
  repeat('b',64), '55555555-cccc-4555-8555-555555555555')),
  1::bigint, 'scope-free state is consumable');
select ok(public.start_connector_oauth_code_exchange(
  (select id from app_private.connector_oauth_states
   where consume_key = '55555555-cccc-4555-8555-555555555555'),
  '55555555-cccc-4555-8555-555555555555',
  (select processing_lease_token from app_private.connector_oauth_states
   where consume_key = '55555555-cccc-4555-8555-555555555555'),
  '56565656-cccc-4565-8565-565656565656', now()),
  'scope-free callback owns the token exchange');
select lives_ok($test$select public.complete_connector_oauth_connection(
  '22222222-cccc-4222-8222-222222222222',
  (select id from public.connector_installations
    where brand_id = '22222222-cccc-4222-8222-222222222222'),
  'oauth-scope-free-test', '11111111-cccc-4111-8111-111111111111',
  '55555555-cccc-4555-8555-555555555555',
  '{"access_token":"scope-free-access-token","external_account_id":"scope-free-account"}',
  'Scope Free Account',
  array[]::text[], null)$test$, 'scope-free completion is accepted');
select is((select status from public.connector_installations
  where brand_id = '22222222-cccc-4222-8222-222222222222'), 'connected_healthy',
  'scope-free installation becomes healthy');
select is((select enabled_capabilities from public.connector_installations
  where brand_id = '22222222-cccc-4222-8222-222222222222'),
  array['account.health'], 'scope-free certified capability is enabled');
select is((select granted_scopes from public.credential_references
  where brand_id = '22222222-cccc-4222-8222-222222222222'),
  array[]::text[], 'empty grant is stored as an explicit scope set');
select * from finish();
rollback;
