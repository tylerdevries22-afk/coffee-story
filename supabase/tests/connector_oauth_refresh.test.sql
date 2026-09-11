begin;
create extension if not exists pgtap with schema extensions;
set search_path = extensions, public, pg_catalog;
select plan(38);

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('11111111-dddd-4111-8111-111111111111', 'refresh-owner@example.test', '{}', '{}');
insert into public.brands (id, slug, name) values
  ('22222222-dddd-4222-8222-222222222222', 'oauth-refresh-test', 'OAuth Refresh');
insert into public.brand_users (user_id, brand_id, role) values
  ('11111111-dddd-4111-8111-111111111111',
   '22222222-dddd-4222-8222-222222222222', 'brand_owner');
update public.connector_registry set availability = 'available', is_active = true
where provider_key = 'slack';
update public.connector_capabilities set is_active = true
where provider_id = (select id from public.connector_registry where provider_key = 'slack')
  and capability_key = 'alerts.write';
update public.connector_certifications set status = 'passed', certified_at = now(),
  valid_until = now() + interval '1 day'
where capability_id = (select id from public.connector_capabilities
  where provider_id = (select id from public.connector_registry where provider_key = 'slack')
    and capability_key = 'alerts.write') and environment = 'sandbox';

select lives_ok($test$select public.begin_connector_oauth_state(
  '22222222-dddd-4222-8222-222222222222', 'slack',
  '11111111-dddd-4111-8111-111111111111', repeat('d',64), repeat('e',64),
  array['chat:write'], 'https://hq.example.test/slack/callback',
  now() + interval '10 minutes')$test$, 'refreshable grant begins');
select is((select count(*) from public.consume_connector_oauth_state(
  'slack', '11111111-dddd-4111-8111-111111111111', repeat('d',64),
  repeat('e',64), '33333333-dddd-4333-8333-333333333333')),
  1::bigint, 'refreshable grant is consumed');
select ok(public.start_connector_oauth_code_exchange(
  (select id from app_private.connector_oauth_states
   where consume_key = '33333333-dddd-4333-8333-333333333333'),
  '33333333-dddd-4333-8333-333333333333',
  (select processing_lease_token from app_private.connector_oauth_states
   where consume_key = '33333333-dddd-4333-8333-333333333333'),
  '34343434-dddd-4343-8343-343434343434', now()),
  'refreshable callback owns the token exchange');
select lives_ok($test$select public.complete_connector_oauth_connection(
  '22222222-dddd-4222-8222-222222222222',
  (select id from public.connector_installations
   where brand_id = '22222222-dddd-4222-8222-222222222222'),
  'slack', '11111111-dddd-4111-8111-111111111111',
  '33333333-dddd-4333-8333-333333333333',
  '{"access_token":"initial-access-token","refresh_token":"initial-refresh-token","external_account_id":"slack-refresh-account"}',
  'Refresh Account', array['chat:write'], now() + interval '1 hour')$test$,
  'short lived renewable credential is stored');
select is((select status from public.connector_installations
  where brand_id = '22222222-dddd-4222-8222-222222222222'), 'connected_healthy',
  'short access expiry remains healthy with a refresh job');
select is((select count(*) from app_private.connector_oauth_lifecycle_jobs
  where brand_id = '22222222-dddd-4222-8222-222222222222' and operation = 'refresh'),
  1::bigint, 'completion creates one refresh job');

update app_private.connector_oauth_lifecycle_jobs set next_attempt_at = now()
where brand_id = '22222222-dddd-4222-8222-222222222222' and operation = 'refresh';
create temp table refresh_claim as select *
from public.claim_connector_oauth_refreshes(now(), 1, 60);
select is((select count(*) from refresh_claim), 1::bigint, 'one refresh lease is claimed');
select is((select jsonb_typeof(credential) from refresh_claim), 'object',
  'claim resolves the credential inside the service boundary');
select is((select granted_scopes from refresh_claim), array['chat:write'],
  'claim returns the prior grant for safe scope intersection');
select is((select public.complete_connector_oauth_refresh(
  job_id, gen_random_uuid(),
  '{"access_token":"rotated-access-token","refresh_token":"rotated-refresh-token","external_account_id":"slack-refresh-account"}',
  now() + interval '2 hours', now()) from refresh_claim), false,
  'wrong lease cannot finalize refresh');
select ok((select public.fail_connector_oauth_refresh(
  job_id, lease_token, 'provider_timeout', true, now()) from refresh_claim),
  'retryable failure releases the lease');
select is((select public.complete_connector_oauth_refresh(
  job_id, lease_token,
  '{"access_token":"rotated-access-token","refresh_token":"rotated-refresh-token","external_account_id":"slack-refresh-account"}',
  now() + interval '2 hours', now()) from refresh_claim), false,
  'complete after failure cannot claim the failed outcome');
select ok((select public.fail_connector_oauth_refresh(
  job_id, lease_token, 'provider_timeout', true, now()) from refresh_claim),
  'same failure response is replayable');
select is((select public.fail_connector_oauth_refresh(
  job_id, lease_token, 'changed_error', true, now()) from refresh_claim), false,
  'changed failure payload is not replayable');
select is((select status from public.connector_installations
  where brand_id = '22222222-dddd-4222-8222-222222222222'), 'connected_degraded',
  'retryable refresh failure degrades locally');
update public.credential_references set expires_at = now() - interval '1 minute'
where brand_id = '22222222-dddd-4222-8222-222222222222';
select lives_ok('select public.reconcile_connector_credential_status(now(), 10)',
  'reconcile accepts an expired credential with retry pending');
select is((select status from public.connector_installations
  where brand_id = '22222222-dddd-4222-8222-222222222222'), 'connected_degraded',
  'expired credential stays claimable while retry is pending');
select is((select count(*) from public.claim_connector_oauth_refreshes(now(), 1, 60)),
  0::bigint, 'bounded backoff prevents an early retry');

create temp table retry_clock as
select next_attempt_at + interval '1 second' as clock_at
from app_private.connector_oauth_lifecycle_jobs
where brand_id = '22222222-dddd-4222-8222-222222222222' and operation = 'refresh';
create temp table refresh_retry as select * from public.claim_connector_oauth_refreshes(
  (select clock_at from retry_clock), 1, 60);
select ok((select count(*) = 1 from refresh_retry)
  and (select lease_token from refresh_retry) <>
    (select lease_token from refresh_claim),
  'retry receives a fresh lease token');
select ok((select public.start_connector_oauth_credential_rotation(job_id,lease_token,(select clock_at from retry_clock)) from refresh_retry),'retry records provider rotation intent');
select ok((select public.complete_connector_oauth_refresh(
  job_id, lease_token,
  '{"access_token":"rotated-access-token","refresh_token":"rotated-refresh-token","external_account_id":"slack-refresh-account","granted_scopes":["chat:write"]}',
  (select clock_at + interval '2 hours' from retry_clock),
  (select clock_at from retry_clock))
  from refresh_retry), 'current lease rotates with CAS');
select ok((select public.complete_connector_oauth_refresh(
  job_id, lease_token,
  '{"access_token":"rotated-access-token","refresh_token":"rotated-refresh-token","external_account_id":"slack-refresh-account","granted_scopes":["chat:write"]}',
  (select clock_at + interval '2 hours' from retry_clock),
  (select clock_at from retry_clock))
  from refresh_retry), 'same completion payload is replayable');
select is((select public.complete_connector_oauth_refresh(
  job_id, lease_token,
  '{"access_token":"changed-access-token","refresh_token":"rotated-refresh-token","external_account_id":"slack-refresh-account","granted_scopes":["chat:write"]}',
  (select clock_at + interval '2 hours' from retry_clock),
  (select clock_at from retry_clock))
  from refresh_retry), false, 'changed completion payload is not replayable');
select is((select public.fail_connector_oauth_refresh(
  job_id, lease_token, 'provider_timeout', true,
  (select clock_at from retry_clock))
  from refresh_retry), false, 'failure cannot overwrite a completed outcome');
select is((select credential_generation from public.credential_references
  where brand_id = '22222222-dddd-4222-8222-222222222222'), 2::bigint,
  'successful rotation advances the reference generation');
select is((select secret.decrypted_secret::jsonb->>'access_token'
  from public.credential_references reference join vault.decrypted_secrets secret
    on secret.id = reference.vault_secret_id
  where reference.brand_id = '22222222-dddd-4222-8222-222222222222'),
  'rotated-access-token', 'Vault stores the rotated credential without scope metadata');
select ok((select state = 'pending' and attempt_count = 0 and credential_generation = 2
  from app_private.connector_oauth_lifecycle_jobs
  where brand_id = '22222222-dddd-4222-8222-222222222222' and operation = 'refresh'),
  'successful refresh resets consecutive attempts and advances job CAS');
select is((select status from public.connector_installations
  where brand_id = '22222222-dddd-4222-8222-222222222222'), 'connected_healthy',
  'valid refreshed grant restores healthy state');

update app_private.connector_oauth_lifecycle_jobs
set next_attempt_at = (select clock_at + interval '3 hours' from retry_clock)
where brand_id = '22222222-dddd-4222-8222-222222222222' and operation = 'refresh';
create temp table late_clock as
select clock_at + interval '3 hours' as clock_at from retry_clock;
create temp table refresh_late as select * from public.claim_connector_oauth_refreshes(
  (select clock_at from late_clock), 1, 60);
select is((select count(*) from refresh_late), 1::bigint, 'late-settle lease is claimed');
select ok((select public.start_connector_oauth_credential_rotation(job_id,lease_token,(select clock_at from late_clock)) from refresh_late),'late lease records provider rotation intent');
update app_private.connector_oauth_lifecycle_jobs
set lease_expires_at = (select clock_at - interval '1 second' from late_clock)
where id = (select job_id from refresh_late);
select ok((select public.complete_connector_oauth_refresh(
  job_id, lease_token,
  '{"access_token":"late-access-token","refresh_token":"late-refresh-token","external_account_id":"slack-refresh-account"}',
  (select clock_at + interval '2 hours' from late_clock),
  (select clock_at from late_clock))
  from refresh_late), 'matching lease can settle after expiry before a claimant fences it');
select is((select credential_generation from public.credential_references
  where brand_id = '22222222-dddd-4222-8222-222222222222'), 3::bigint,
  'late settlement still advances exactly one generation');

update app_private.connector_oauth_lifecycle_jobs
set next_attempt_at = (select clock_at + interval '3 hours' from late_clock)
where brand_id = '22222222-dddd-4222-8222-222222222222' and operation = 'refresh';
create temp table narrow_clock as
select clock_at + interval '3 hours' as clock_at from late_clock;
create temp table refresh_narrow as select * from public.claim_connector_oauth_refreshes(
  (select clock_at from narrow_clock), 1, 60);
select is((select count(*) from refresh_narrow), 1::bigint, 'scope-check lease is claimed');
select ok((select public.start_connector_oauth_credential_rotation(job_id,lease_token,(select clock_at from narrow_clock)) from refresh_narrow),'scope-check lease records provider rotation intent');
select ok((select public.complete_connector_oauth_refresh(
  job_id, lease_token,
  '{"access_token":"narrow-access-token","refresh_token":"narrow-refresh-token","external_account_id":"slack-refresh-account","granted_scopes":[]}',
  (select clock_at + interval '2 hours' from narrow_clock),
  (select clock_at from narrow_clock))
  from refresh_narrow), 'narrowed provider grant is durably classified');
select ok((select status = 'reauthorization_required' and cardinality(enabled_capabilities) = 0
  from public.connector_installations
  where brand_id = '22222222-dddd-4222-8222-222222222222'),
  'narrowed grant removes capability access and requires authorization');
select is((select granted_scopes from public.credential_references
  where brand_id = '22222222-dddd-4222-8222-222222222222'), array[]::text[],
  'reported scopes are intersected without retaining stale grants');
select is((select state from app_private.connector_oauth_lifecycle_jobs
  where brand_id = '22222222-dddd-4222-8222-222222222222' and operation = 'refresh'),
  'permanent_failure', 'scope contract failure stops refresh retries');

select * from finish();
rollback;
