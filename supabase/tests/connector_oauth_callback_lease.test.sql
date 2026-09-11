begin;
create extension if not exists pgtap with schema extensions;
set search_path = extensions, public, pg_catalog;
select plan(27);

select has_function('public', 'consume_connector_oauth_state',
  array['text','uuid','text','text','uuid'], 'stable consume RPC exists');
select has_function('public', 'start_connector_oauth_code_exchange',
  array['uuid','uuid','uuid','uuid','timestamptz'], 'exchange start RPC exists');
select has_function('public', 'cancel_connector_oauth_code_exchange',
  array['uuid','uuid','uuid','uuid','timestamptz'], 'exchange cancel RPC exists');
select lives_ok('select app.assert_connector_oauth_runtime()', 'runtime manifest is valid');
select ok(not has_function_privilege('anon',
  'public.start_connector_oauth_code_exchange(uuid,uuid,uuid,uuid,timestamptz)',
  'EXECUTE'), 'anonymous callers cannot own an exchange');
select ok(has_function_privilege('service_role',
  'public.start_connector_oauth_code_exchange(uuid,uuid,uuid,uuid,timestamptz)',
  'EXECUTE'), 'service role can own an exchange');
select ok(not has_function_privilege('anon',
  'public.cancel_connector_oauth_code_exchange(uuid,uuid,uuid,uuid,timestamptz)',
  'EXECUTE'), 'anonymous callers cannot cancel an exchange');
select ok(has_function_privilege('service_role',
  'public.cancel_connector_oauth_code_exchange(uuid,uuid,uuid,uuid,timestamptz)',
  'EXECUTE'), 'service role can cancel an exchange');

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('10000000-abcd-4000-8000-000000000001','callback-owner@example.test','{}','{}');
insert into public.brands (id, slug, name) values
  ('20000000-abcd-4000-8000-000000000002','oauth-callback-test','OAuth Callback');
insert into public.brand_users (user_id, brand_id, role) values
  ('10000000-abcd-4000-8000-000000000001',
   '20000000-abcd-4000-8000-000000000002','brand_owner');
insert into public.connector_registry (
  id, provider_key, display_name, category, availability, logo_path,
  logo_source_url, logo_license, oauth_lifecycle_managed,
  oauth_revocation_scope, oauth_grant_namespace
) values ('30000000-abcd-4000-8000-000000000003','oauth-callback-test',
  'OAuth Callback','platform','available','/test.svg','https://example.test/logo.svg',
  'test',true,'credential','oauth-callback-test');
insert into public.connector_capabilities (
  id, provider_id, capability_key, display_name, access_mode, oauth_scopes
) values ('40000000-abcd-4000-8000-000000000004',
  '30000000-abcd-4000-8000-000000000003','profile.read','Profile','read',
  array['profile.read']);
insert into public.connector_certifications (
  capability_id, environment, status, contract_version, certified_at, valid_until
) values ('40000000-abcd-4000-8000-000000000004','sandbox','passed','1.0.0',
  now(),now()+interval '1 day');

select lives_ok($q$select public.begin_connector_oauth_state(
  '20000000-abcd-4000-8000-000000000002','oauth-callback-test',
  '10000000-abcd-4000-8000-000000000001',repeat('a',64),repeat('b',64),
  array['profile.read'],'https://hq.example.test/callback',now()+interval '10 minutes')$q$,
  'callback begins');
create temp table first_claim as select * from public.consume_connector_oauth_state(
  'oauth-callback-test','10000000-abcd-4000-8000-000000000001',repeat('a',64),
  repeat('b',64),'50000000-abcd-4000-8000-000000000005');
select is((select count(*) from first_claim),1::bigint,'fresh consume returns one state');
select ok((select processing_acquired and processing_generation=1
  and processing_lease_expires_at>now() from first_claim),
  'fresh consume grants a bounded processing lease');
create temp table replay_claim as select * from public.consume_connector_oauth_state(
  'oauth-callback-test','10000000-abcd-4000-8000-000000000001',repeat('a',64),
  repeat('b',64),'50000000-abcd-4000-8000-000000000005');
select ok((select consume_replayed and processing_acquired
  and processing_lease_token=(select processing_lease_token from first_claim)
  and processing_generation=1 from replay_claim),
  'a lost consume response replays the unstarted lease');
select is((select public.start_connector_oauth_code_exchange(
  state_id,consume_key,gen_random_uuid(),'60000000-abcd-4000-8000-000000000006',now())
  from replay_claim),false,'a foreign lease cannot start exchange');
select ok((select public.start_connector_oauth_code_exchange(
  state_id,consume_key,processing_lease_token,
  '60000000-abcd-4000-8000-000000000006',now()) from replay_claim),
  'one callback attempt owns exchange');
select ok((select public.cancel_connector_oauth_code_exchange(
  state_id,consume_key,processing_lease_token,
  '60000000-abcd-4000-8000-000000000006',now()) from replay_claim),
  'a lost start response is cancellable before provider I/O');
select ok((select public.start_connector_oauth_code_exchange(
  state_id,consume_key,processing_lease_token,
  '60000000-abcd-4000-8000-000000000006',now()) from replay_claim),
  'the cancelled callback attempt can restart safely');
select ok((select public.start_connector_oauth_code_exchange(
  state_id,consume_key,processing_lease_token,
  '60000000-abcd-4000-8000-000000000006',now()) from replay_claim),
  'lost exchange-start response is replayable by the same attempt');
select is((select public.start_connector_oauth_code_exchange(
  state_id,consume_key,processing_lease_token,
  '61000000-abcd-4000-8000-000000000006',now()) from replay_claim),false,
  'a concurrent callback attempt cannot exchange the code');
create temp table started_replay as select * from public.consume_connector_oauth_state(
  'oauth-callback-test','10000000-abcd-4000-8000-000000000001',repeat('a',64),
  repeat('b',64),'50000000-abcd-4000-8000-000000000005');
select ok((select consume_replayed and exchange_started and not processing_acquired
  from started_replay),'started exchange cannot be reclaimed concurrently');
select ok(public.complete_connector_oauth_connection(
  '20000000-abcd-4000-8000-000000000002',
  (select installation_id from first_claim),'oauth-callback-test',
  '10000000-abcd-4000-8000-000000000001',
  '50000000-abcd-4000-8000-000000000005',
  '{"access_token":"callback-access-token","external_account_id":"callback-account"}',
  'Callback Account',array['profile.read'],null) is not null,
  'owned exchange completes once');
create temp table completed_replay as select * from public.consume_connector_oauth_state(
  'oauth-callback-test','10000000-abcd-4000-8000-000000000001',repeat('a',64),
  repeat('b',64),'50000000-abcd-4000-8000-000000000005');
select ok((select consume_replayed and completion_outcome='connected'
  and completed_reference_id is not null and processing_lease_token is null
  from completed_replay),'consume replay returns the durable completion outcome');

select lives_ok($q$select public.begin_connector_oauth_state(
  '20000000-abcd-4000-8000-000000000002','oauth-callback-test',
  '10000000-abcd-4000-8000-000000000001',repeat('c',64),repeat('d',64),
  array['profile.read'],'https://hq.example.test/callback',now()+interval '10 minutes')$q$,
  'a later callback begins');
select is((select count(*) from public.consume_connector_oauth_state(
  'oauth-callback-test','10000000-abcd-4000-8000-000000000001',repeat('c',64),
  repeat('e',64),'70000000-abcd-4000-8000-000000000007')),0::bigint,
  'wrong cookie binding does not consume state');
create temp table abandoned as select * from public.consume_connector_oauth_state(
  'oauth-callback-test','10000000-abcd-4000-8000-000000000001',repeat('c',64),
  repeat('d',64),'70000000-abcd-4000-8000-000000000007');
select is((select count(*) from abandoned),1::bigint,'correct cookie consumes state');
update app_private.connector_oauth_states set processing_lease_expires_at=now()-interval '1s'
where id=(select state_id from abandoned);
create temp table reclaimed as select * from public.consume_connector_oauth_state(
  'oauth-callback-test','10000000-abcd-4000-8000-000000000001',repeat('c',64),
  repeat('d',64),'70000000-abcd-4000-8000-000000000007');
select ok((select processing_acquired and processing_generation=2
  and processing_lease_token<>(select processing_lease_token from abandoned)
  from reclaimed),'expired unstarted consume lease is safely reclaimed');
select is((select public.start_connector_oauth_code_exchange(
  state_id,consume_key,processing_lease_token,
  '71000000-abcd-4000-8000-000000000007',now()) from abandoned),false,
  'expired consume lease cannot start a stale exchange');
select ok((select public.start_connector_oauth_code_exchange(
  state_id,consume_key,processing_lease_token,
  '72000000-abcd-4000-8000-000000000007',now()) from reclaimed),
  'reclaimed callback can own exchange');

select * from finish();
rollback;
