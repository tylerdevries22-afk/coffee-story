begin;
create extension if not exists pgtap with schema extensions;
set search_path = extensions, public, pg_catalog;
select plan(40);

select has_function('public', 'begin_connector_oauth_state',
  array['uuid','text','uuid','text','text','text[]','text','timestamptz']);
select has_function('public', 'consume_connector_oauth_state',
  array['text','uuid','text','text','uuid']);
select has_function('public', 'start_connector_oauth_code_exchange',
  array['uuid','uuid','uuid','uuid','timestamptz']);
select ok(to_regprocedure('public.consume_connector_oauth_state(text,uuid,text)') is null,
  'the destructive three-argument consumer is removed');
select has_function('public', 'complete_connector_oauth_connection',
  array['uuid','uuid','text','uuid','uuid','jsonb','text','text[]','timestamptz']);
select ok(to_regprocedure(
  'public.complete_connector_oauth_connection(uuid,uuid,text,uuid,jsonb,text,text[],timestamptz)'
  ) is null, 'the non-idempotent completion overload is removed');
select lives_ok('select app.assert_connector_oauth_runtime()');

select ok(not has_function_privilege('anon',
  'public.begin_connector_oauth_state(uuid,text,uuid,text,text,text[],text,timestamptz)', 'EXECUTE'));
select ok(not has_function_privilege('authenticated',
  'public.begin_connector_oauth_state(uuid,text,uuid,text,text,text[],text,timestamptz)', 'EXECUTE'));
select ok(has_function_privilege('service_role',
  'public.begin_connector_oauth_state(uuid,text,uuid,text,text,text[],text,timestamptz)', 'EXECUTE'));
select ok(not has_function_privilege('anon',
  'public.consume_connector_oauth_state(text,uuid,text,text,uuid)', 'EXECUTE'));
select ok(not has_function_privilege('authenticated',
  'public.consume_connector_oauth_state(text,uuid,text,text,uuid)', 'EXECUTE'));
select ok(has_function_privilege('service_role',
  'public.consume_connector_oauth_state(text,uuid,text,text,uuid)', 'EXECUTE'));
select ok(not has_function_privilege('anon',
  'public.start_connector_oauth_code_exchange(uuid,uuid,uuid,uuid,timestamptz)', 'EXECUTE'));
select ok(not has_function_privilege('authenticated',
  'public.start_connector_oauth_code_exchange(uuid,uuid,uuid,uuid,timestamptz)', 'EXECUTE'));
select ok(has_function_privilege('service_role',
  'public.start_connector_oauth_code_exchange(uuid,uuid,uuid,uuid,timestamptz)', 'EXECUTE'));
select ok(not has_function_privilege('anon',
  'public.complete_connector_oauth_connection(uuid,uuid,text,uuid,uuid,jsonb,text,text[],timestamptz)', 'EXECUTE'));
select ok(not has_function_privilege('authenticated',
  'public.complete_connector_oauth_connection(uuid,uuid,text,uuid,uuid,jsonb,text,text[],timestamptz)', 'EXECUTE'));
select ok(has_function_privilege('service_role',
  'public.complete_connector_oauth_connection(uuid,uuid,text,uuid,uuid,jsonb,text,text[],timestamptz)', 'EXECUTE'));
select has_index('app_private', 'connector_oauth_states',
  'connector_oauth_states_active_actor_idx');

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('51515151-5151-4515-8515-515151515151', 'oauth-owner@example.test', '{}', '{}');
insert into public.brands (id, slug, name) values
  ('61616161-6161-4616-8616-616161616161', 'oauth-runtime-test', 'OAuth Runtime');
insert into public.brand_users (user_id, brand_id, role) values
  ('51515151-5151-4515-8515-515151515151',
   '61616161-6161-4616-8616-616161616161', 'brand_owner');
insert into public.connector_registry (
  provider_key, display_name, category, availability, logo_path, logo_source_url,
  logo_license, oauth_lifecycle_managed, oauth_revocation_scope, oauth_grant_namespace
) values ('oauth-runtime-test', 'OAuth Runtime', 'platform', 'available', '/test.svg',
  'https://example.test/logo.svg', 'test', true, 'credential', 'oauth-runtime-test');
insert into public.connector_capabilities (
  provider_id, capability_key, display_name, access_mode, oauth_scopes
) select id, 'profile.read', 'Profile read', 'read', array['profile.read']
  from public.connector_registry where provider_key = 'oauth-runtime-test';
insert into public.connector_certifications (
  capability_id, environment, status, contract_version, certified_at, valid_until
) select id, 'sandbox', 'passed', '1.0.0', now(), now() + interval '1 day'
  from public.connector_capabilities where capability_key = 'profile.read';

select lives_ok($q$select public.begin_connector_oauth_state(
  '61616161-6161-4616-8616-616161616161','oauth-runtime-test',
  '51515151-5151-4515-8515-515151515151',repeat('a',64),repeat('c',64),
  array['profile.read'],'https://hq.example.test/callback',now()+interval '10 minutes')$q$);
select is((select count(*) from public.consume_connector_oauth_state(
  'oauth-runtime-test','51515151-5151-4515-8515-515151515151',repeat('a',64),
  repeat('c',64),'71717171-7171-4717-8717-717171717171')), 1::bigint);
select is((select count(*) from public.consume_connector_oauth_state(
  'oauth-runtime-test','51515151-5151-4515-8515-515151515151',repeat('a',64),
  repeat('c',64),'71717171-7171-4717-8717-717171717171')), 1::bigint,
  'same consume key replays the state');
select ok(public.start_connector_oauth_code_exchange(
  (select id from app_private.connector_oauth_states
   where consume_key='71717171-7171-4717-8717-717171717171'),
  '71717171-7171-4717-8717-717171717171',
  (select processing_lease_token from app_private.connector_oauth_states
   where consume_key='71717171-7171-4717-8717-717171717171'),
  '81818181-8181-4818-8818-818181818181',now()),
  'the callback atomically owns provider exchange');
select is((select count(*) from public.consume_connector_oauth_state(
  'oauth-runtime-test','51515151-5151-4515-8515-515151515151',repeat('a',64),
  repeat('c',64),'72727272-7272-4727-8727-727272727272')), 0::bigint,
  'a different consume key cannot steal the state');
select lives_ok($q$select public.begin_connector_oauth_state(
  '61616161-6161-4616-8616-616161616161','oauth-runtime-test',
  '51515151-5151-4515-8515-515151515151',repeat('b',64),repeat('d',64),
  array['profile.read'],'https://hq.example.test/callback',now()+interval '10 minutes')$q$);
select is((select count(*) from app_private.connector_oauth_states
  where superseded_at is not null), 1::bigint);
select is((select public.complete_connector_oauth_connection(
  '61616161-6161-4616-8616-616161616161',
  (select id from public.connector_installations where brand_id='61616161-6161-4616-8616-616161616161'),
  'oauth-runtime-test','51515151-5151-4515-8515-515151515151',
  '71717171-7171-4717-8717-717171717171',
  '{"access_token":"superseded-access-token","external_account_id":"runtime-account"}',
  'Runtime Account',array['profile.read'],null)), null::uuid,
  'a superseded issued credential is staged for cleanup');
select is((select completion_outcome from app_private.connector_oauth_states
  where consume_key='71717171-7171-4717-8717-717171717171'), 'cleanup_queued');
select is((select count(*) from public.consume_connector_oauth_state(
  'oauth-runtime-test','51515151-5151-4515-8515-515151515151',repeat('b',64),
  repeat('d',64),'73737373-7373-4737-8737-737373737373')), 1::bigint);
select ok(public.start_connector_oauth_code_exchange(
  (select id from app_private.connector_oauth_states
   where consume_key='73737373-7373-4737-8737-737373737373'),
  '73737373-7373-4737-8737-737373737373',
  (select processing_lease_token from app_private.connector_oauth_states
   where consume_key='73737373-7373-4737-8737-737373737373'),
  '83838383-8383-4838-8838-838383838383',now()),
  'the replacement callback owns provider exchange');
select ok((select public.complete_connector_oauth_connection(
  '61616161-6161-4616-8616-616161616161',
  (select id from public.connector_installations where brand_id='61616161-6161-4616-8616-616161616161'),
  'oauth-runtime-test','51515151-5151-4515-8515-515151515151',
  '73737373-7373-4737-8737-737373737373',
  '{"access_token":"connected-access-token","external_account_id":"runtime-account"}',
  'Runtime Account',array['profile.read'],null)) is not null);
select is((select status from public.connector_installations
  where brand_id='61616161-6161-4616-8616-616161616161'), 'connected_healthy');
select ok((select credential_reference_id is not null from public.connector_installations
  where brand_id='61616161-6161-4616-8616-616161616161'));
select is((select count(*) from public.connector_audit_events
  where brand_id='61616161-6161-4616-8616-616161616161' and action='oauth.connected'), 1::bigint);
select is((select completion_outcome from app_private.connector_oauth_states
  where consume_key='73737373-7373-4737-8737-737373737373'), 'connected');

update public.connector_registry set availability='disabled' where provider_key='oauth-runtime-test';
delete from public.brand_users where brand_id='61616161-6161-4616-8616-616161616161';
select is((select public.complete_connector_oauth_connection(
  '61616161-6161-4616-8616-616161616161',
  (select id from public.connector_installations where brand_id='61616161-6161-4616-8616-616161616161'),
  'oauth-runtime-test','51515151-5151-4515-8515-515151515151',
  '73737373-7373-4737-8737-737373737373',
  '{"access_token":"connected-access-token","external_account_id":"runtime-account"}',
  'Runtime Account',array['profile.read'],null)),
  (select completed_reference_id from app_private.connector_oauth_states
   where consume_key='73737373-7373-4737-8737-737373737373'));
select is((select count(*) from public.connector_audit_events
  where brand_id='61616161-6161-4616-8616-616161616161' and action='oauth.connected'), 1::bigint);
select throws_ok($q$select public.complete_connector_oauth_connection(
  '61616161-6161-4616-8616-616161616161',
  (select id from public.connector_installations where brand_id='61616161-6161-4616-8616-616161616161'),
  'oauth-runtime-test','51515151-5151-4515-8515-515151515151',
  '73737373-7373-4737-8737-737373737373',
  '{"access_token":"changed-access-token","external_account_id":"runtime-account"}',
  'Runtime Account',array['profile.read'],null)$q$, '22023',
  'connector_oauth_completion_conflict_shared_grant');
select throws_ok($q$select public.begin_connector_oauth_state(
  '61616161-6161-4616-8616-616161616161','oauth-runtime-test',gen_random_uuid(),
  repeat('e',64),repeat('f',64),'{}','https://hq.example.test/callback',
  now()+interval '10 minutes')$q$, '42501', 'connector_oauth_forbidden');

select * from finish();
rollback;
