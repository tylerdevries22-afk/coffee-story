begin;
create extension if not exists pgtap with schema extensions;
set search_path = extensions, public, pg_catalog;
select plan(24);

select has_function('public', 'begin_connector_oauth_state',
  array['uuid','text','uuid','text','text','text[]','text','timestamptz'],
  'OAuth initiation RPC exists');
select has_function('public', 'consume_connector_oauth_state',
  array['text','uuid','text'], 'OAuth consume RPC exists');
select has_function('public', 'complete_connector_oauth_connection',
  array['uuid','uuid','text','uuid','jsonb','text','text[]','timestamptz'],
  'OAuth completion RPC exists');

select ok(not has_function_privilege('anon',
  'public.begin_connector_oauth_state(uuid,text,uuid,text,text,text[],text,timestamptz)', 'EXECUTE'),
  'anon cannot initiate OAuth');
select ok(not has_function_privilege('authenticated',
  'public.begin_connector_oauth_state(uuid,text,uuid,text,text,text[],text,timestamptz)', 'EXECUTE'),
  'authenticated clients cannot initiate OAuth directly');
select ok(has_function_privilege('service_role',
  'public.begin_connector_oauth_state(uuid,text,uuid,text,text,text[],text,timestamptz)', 'EXECUTE'),
  'service role can initiate OAuth');
select ok(not has_function_privilege('anon',
  'public.consume_connector_oauth_state(text,uuid,text)', 'EXECUTE'),
  'anon cannot consume OAuth state');
select ok(not has_function_privilege('authenticated',
  'public.consume_connector_oauth_state(text,uuid,text)', 'EXECUTE'),
  'authenticated clients cannot consume OAuth state directly');
select ok(has_function_privilege('service_role',
  'public.consume_connector_oauth_state(text,uuid,text)', 'EXECUTE'),
  'service role can consume OAuth state');
select ok(not has_function_privilege('anon',
  'public.complete_connector_oauth_connection(uuid,uuid,text,uuid,jsonb,text,text[],timestamptz)', 'EXECUTE'),
  'anon cannot store OAuth credentials');
select ok(not has_function_privilege('authenticated',
  'public.complete_connector_oauth_connection(uuid,uuid,text,uuid,jsonb,text,text[],timestamptz)', 'EXECUTE'),
  'authenticated clients cannot store OAuth credentials directly');
select ok(has_function_privilege('service_role',
  'public.complete_connector_oauth_connection(uuid,uuid,text,uuid,jsonb,text,text[],timestamptz)', 'EXECUTE'),
  'service role can complete OAuth');
select has_index('app_private', 'connector_oauth_states',
  'connector_oauth_states_active_actor_idx', 'active tenant OAuth lookup is indexed');

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('51515151-5151-4515-8515-515151515151', 'oauth-owner@example.test', '{}', '{}');
insert into public.brands (id, slug, name) values
  ('61616161-6161-4616-8616-616161616161', 'oauth-runtime-test', 'OAuth Runtime Test');
insert into public.brand_users (user_id, brand_id, role) values
  ('51515151-5151-4515-8515-515151515151',
   '61616161-6161-4616-8616-616161616161', 'brand_owner');
insert into public.connector_registry (
  provider_key, display_name, category, availability, logo_path, logo_source_url, logo_license
) values (
  'oauth-runtime-test', 'OAuth Runtime Test', 'platform', 'available', '/test.svg',
  'https://example.test/logo.svg', 'test-only'
);
insert into public.connector_capabilities (
  provider_id, capability_key, display_name, access_mode, oauth_scopes
) select id, 'profile.read', 'Profile read', 'read', array['profile.read']
  from public.connector_registry where provider_key = 'oauth-runtime-test';
insert into public.connector_certifications (
  capability_id, environment, status, contract_version, certified_at, valid_until
) select id, 'sandbox', 'passed', '1.0.0', now(), now() + interval '1 day'
  from public.connector_capabilities where capability_key = 'profile.read';

select lives_ok($test$select public.begin_connector_oauth_state(
  '61616161-6161-4616-8616-616161616161', 'oauth-runtime-test',
  '51515151-5151-4515-8515-515151515151', repeat('a', 64), repeat('c', 64),
  array['profile.read'], 'http://127.0.0.1:3300/api/connectors/oauth-runtime-test/callback',
  now() + interval '10 minutes')$test$, 'an owner can start a localhost development grant');
select is((select count(*) from app_private.connector_oauth_states where consumed_at is null),
  1::bigint, 'one active state is retained');
select lives_ok($test$select public.begin_connector_oauth_state(
  '61616161-6161-4616-8616-616161616161', 'oauth-runtime-test',
  '51515151-5151-4515-8515-515151515151', repeat('b', 64), repeat('d', 64),
  array['profile.read'], 'https://hq.example.test/api/connectors/oauth-runtime-test/callback',
  now() + interval '10 minutes')$test$, 'a new grant safely supersedes the prior state');
select is((select count(*) from app_private.connector_oauth_states where consumed_at is not null),
  1::bigint, 'the prior state is invalidated');
select is((select count(*) from public.consume_connector_oauth_state(
  'oauth-runtime-test', '51515151-5151-4515-8515-515151515151', repeat('b', 64))),
  1::bigint, 'the current state is consumed once');
select is((select count(*) from public.consume_connector_oauth_state(
  'oauth-runtime-test', '51515151-5151-4515-8515-515151515151', repeat('b', 64))),
  0::bigint, 'a replay cannot consume the state again');
select lives_ok($test$select public.complete_connector_oauth_connection(
  '61616161-6161-4616-8616-616161616161',
  (select id from public.connector_installations where brand_id = '61616161-6161-4616-8616-616161616161'),
  'oauth-runtime-test', '51515151-5151-4515-8515-515151515151',
  '{"access_token":"test-access-token","refresh_token":"test-refresh-token"}',
  'Test Account', array['profile.read'], now() + interval '1 hour')$test$,
  'a verified grant is stored through Vault');
select is((select status from public.connector_installations
  where brand_id = '61616161-6161-4616-8616-616161616161'),
  'connected_healthy', 'completion marks the tenant installation healthy');
select ok((select credential_reference_id is not null from public.connector_installations
  where brand_id = '61616161-6161-4616-8616-616161616161'),
  'the public installation stores only an opaque credential reference');
select is((select count(*) from public.connector_audit_events
  where brand_id = '61616161-6161-4616-8616-616161616161' and action = 'oauth.connected'),
  1::bigint, 'completion appends a tenant audit event');
select throws_ok($test$select public.begin_connector_oauth_state(
  '61616161-6161-4616-8616-616161616161', 'oauth-runtime-test', gen_random_uuid(),
  repeat('e', 64), repeat('f', 64), '{}', 'https://hq.example.test/callback',
  now() + interval '10 minutes')$test$, '42501', 'connector_oauth_forbidden',
  'an unknown actor cannot start a grant');

select * from finish();
rollback;
