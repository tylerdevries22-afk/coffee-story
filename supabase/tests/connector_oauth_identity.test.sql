begin;
create extension if not exists pgtap with schema extensions;
set search_path = extensions, public, pg_catalog;
select plan(35);

select has_function('public', 'claim_connector_oauth_identities',
  array['timestamptz','integer','integer'], 'identity claim RPC exists');
select has_function('public', 'start_connector_oauth_credential_rotation',
  array['uuid','uuid','timestamptz'], 'credential rotation intent RPC exists');
select has_function('public', 'cancel_connector_oauth_credential_rotation',
  array['uuid','uuid','timestamptz'], 'credential rotation cancel RPC exists');
select has_function('public', 'rotate_connector_oauth_identity_credential',
  array['uuid','uuid','jsonb','timestamptz','timestamptz'],
  'identity credential rotation RPC exists');
select has_function('public', 'complete_connector_oauth_identity',
  array['uuid','uuid','text','timestamptz'], 'identity completion RPC exists');
select has_function('public', 'fail_connector_oauth_identity',
  array['uuid','uuid','text','boolean','timestamptz'], 'identity failure RPC exists');
create temp table identity_signatures(signature text) on commit drop;
insert into identity_signatures values
  ('public.claim_connector_oauth_identities(timestamptz,integer,integer)'),
  ('public.start_connector_oauth_credential_rotation(uuid,uuid,timestamptz)'),
  ('public.cancel_connector_oauth_credential_rotation(uuid,uuid,timestamptz)'),
  ('public.rotate_connector_oauth_identity_credential(uuid,uuid,jsonb,timestamptz,timestamptz)'),
  ('public.complete_connector_oauth_identity(uuid,uuid,text,timestamptz)'),
  ('public.fail_connector_oauth_identity(uuid,uuid,text,boolean,timestamptz)');
select ok((select bool_and(not has_function_privilege('anon', signature, 'EXECUTE')
    and not has_function_privilege('authenticated', signature, 'EXECUTE'))
  from identity_signatures), 'client roles cannot execute identity workers');
select ok((select bool_and(has_function_privilege('service_role', signature, 'EXECUTE'))
  from identity_signatures), 'service role can execute every identity worker');
select ok(not has_table_privilege('service_role',
  'app_private.connector_oauth_lifecycle_jobs', 'SELECT'),
  'service role cannot inspect identity jobs directly');

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('10000000-dddd-4000-8000-000000000001', 'identity-owner@example.test', '{}', '{}');
insert into public.brands (id, slug, name) values
  ('20000000-dddd-4000-8000-000000000002', 'oauth-identity-test', 'OAuth Identity');
insert into public.brand_users (user_id, brand_id, role) values
  ('10000000-dddd-4000-8000-000000000001',
   '20000000-dddd-4000-8000-000000000002', 'brand_owner');
insert into public.connector_registry (
  id, provider_key, display_name, category, availability,
  logo_path, logo_source_url, logo_license, oauth_lifecycle_managed,
  oauth_refresh_managed, oauth_revocation_scope, oauth_grant_namespace
) values ('30000000-dddd-4000-8000-000000000003', 'oauth-identity-test',
  'OAuth Identity', 'platform', 'available', '/test.svg',
  'https://example.test/logo.svg', 'test', true, true, 'grant',
  'oauth-identity-test');
insert into public.connector_capabilities (
  id, provider_id, capability_key, display_name, access_mode, oauth_scopes
) values ('40000000-dddd-4000-8000-000000000004',
  '30000000-dddd-4000-8000-000000000003',
  'profile.read', 'Profile read', 'read', array['profile.read']);
insert into public.connector_certifications (
  capability_id, environment, status, contract_version, certified_at, valid_until
) values ('40000000-dddd-4000-8000-000000000004', 'sandbox', 'passed',
  '1.0.0', now(), now() + interval '1 day');

select lives_ok($test$select public.begin_connector_oauth_state(
  '20000000-dddd-4000-8000-000000000002', 'oauth-identity-test',
  '10000000-dddd-4000-8000-000000000001', repeat('d',64), repeat('e',64),
  array['profile.read'], 'https://hq.example.test/oauth-identity-test/callback',
  now() + interval '10 minutes')$test$, 'owner begins identity fixture grant');
select id as installation_id from public.connector_installations
where brand_id = '20000000-dddd-4000-8000-000000000002' \gset
select is((select count(*) from public.consume_connector_oauth_state(
  'oauth-identity-test', '10000000-dddd-4000-8000-000000000001', repeat('d',64),
  repeat('e',64), '50000000-dddd-4000-8000-000000000005')),
  1::bigint, 'identity fixture state is consumed');
create temp table identity_intake as select public.queue_connector_oauth_compensation(
  '20000000-dddd-4000-8000-000000000002', :'installation_id',
  'oauth-identity-test', '10000000-dddd-4000-8000-000000000001',
  '50000000-dddd-4000-8000-000000000005',
  '60000000-dddd-4000-8000-000000000006',
  '{"access_token":"identity-access-token","refresh_token":"identity-refresh-token"}',
  'Unverified Account', array['profile.read'], now() + interval '1 hour',
  'completion_uncertain', '{"tenant":"hint-only"}') as result;
select is((select result->>'outcome' from identity_intake), 'cleanup_queued',
  'unidentified compensation is durably accepted');
select ok((select job.operation = 'identify' and job.state = 'pending'
    and job.identity_hint = '{"tenant":"hint-only"}'::jsonb
  from app_private.connector_oauth_lifecycle_jobs job
  where job.intake_key = '60000000-dddd-4000-8000-000000000006'),
  'intake queues identity resolution with its bounded hint');

create temp table identity_claim as select *
from public.claim_connector_oauth_identities(now() + interval '1 second', 1, 60);
select is((select count(*) from identity_claim), 1::bigint,
  'one identity job receives a lease');
select ok((select expires_at > now() and granted_scopes = array['profile.read']
    and identity_hint = '{"tenant":"hint-only"}'::jsonb
  from identity_claim), 'claim returns expiry, scopes, and identity hint');
select is((select public.rotate_connector_oauth_identity_credential(
  job_id, gen_random_uuid(),
  '{"access_token":"rotated-access-token","refresh_token":"rotated-refresh-token"}',
  now() + interval '2 hours', now()) from identity_claim), false,
  'an unrelated lease cannot rotate the identity credential');
select ok((select public.start_connector_oauth_credential_rotation(
  job_id, lease_token, now()) from identity_claim),
  'current identity lease records rotation intent before provider I/O');
select ok((select public.cancel_connector_oauth_credential_rotation(
  job_id, lease_token, now()) from identity_claim), 'unstarted provider I/O is releasable');
select ok((select public.start_connector_oauth_credential_rotation(
  job_id, lease_token, now()) from identity_claim), 'released rotation can be reacquired');
select ok((select public.rotate_connector_oauth_identity_credential(
  job_id, lease_token,
  '{"access_token":"rotated-access-token","refresh_token":"rotated-refresh-token","external_account_id":"unverified-spoof"}',
  now() + interval '2 hours', now()) from identity_claim),
  'current identity lease persists a refreshed credential');
select ok((select public.rotate_connector_oauth_identity_credential(
  job_id, lease_token,
  '{"access_token":"rotated-access-token","refresh_token":"rotated-refresh-token","external_account_id":"unverified-spoof"}',
  now() + interval '2 hours', now()) from identity_claim),
  'lost identity rotation response is replayable');
select is((select public.rotate_connector_oauth_identity_credential(
  job_id, lease_token,
  '{"access_token":"changed-access-token","refresh_token":"rotated-refresh-token"}',
  now() + interval '2 hours', now()) from identity_claim), false,
  'same lease cannot persist a different rotation');
select ok((select reference.credential_generation = 2
    and job.credential_generation = 2
    and (secret.decrypted_secret::jsonb)->>'access_token' = 'rotated-access-token'
    and not (secret.decrypted_secret::jsonb ? 'external_account_id')
  from identity_claim claim
  join app_private.connector_oauth_lifecycle_jobs job on job.id = claim.job_id
  join public.credential_references reference on reference.id = job.credential_reference_id
  join vault.decrypted_secrets secret on secret.id = reference.vault_secret_id),
  'rotation advances one CAS generation and strips unverified identity');
select is((select public.complete_connector_oauth_identity(
  job_id, gen_random_uuid(), 'verified-account', now()) from identity_claim), false,
  'an unrelated lease cannot complete identity resolution');
select ok((select public.complete_connector_oauth_identity(
  job_id, lease_token, 'verified-account', now()) from identity_claim),
  'current lease commits verified identity');
select ok((select public.complete_connector_oauth_identity(
  job_id, lease_token, 'verified-account', now()) from identity_claim),
  'lost identity completion response is replayable');
select is((select public.complete_connector_oauth_identity(
  job_id, lease_token, 'changed-account', now()) from identity_claim), false,
  'completed lease rejects a different identity');
select ok((select job.operation = 'revoke' and job.state = 'pending'
    and reference.external_account_fingerprint is not null
    and job.next_attempt_at > now()
  from identity_claim claim
  join app_private.connector_oauth_lifecycle_jobs job on job.id = claim.job_id
  join public.credential_references reference on reference.id = job.credential_reference_id),
  'verified identity atomically transitions the cleanup job to revoke');

select public.store_connector_secret(
  '20000000-dddd-4000-8000-000000000002', 'oauth-identity-test',
  '{"access_token":"retry-access-token","refresh_token":"retry-refresh-token"}',
  'Retry Identity', array['profile.read'], now() + interval '1 day'
) as retry_reference_id \gset
update public.credential_references set revoked_at = now() where id = :'retry_reference_id';
insert into app_private.connector_oauth_lifecycle_jobs (
  id, brand_id, installation_id, credential_reference_id, provider_id,
  operation, state, credential_generation, attempt_count, next_attempt_at,
  lease_token, lease_expires_at
) values ('70000000-dddd-4000-8000-000000000007',
  '20000000-dddd-4000-8000-000000000002', :'installation_id',
  :'retry_reference_id', '30000000-dddd-4000-8000-000000000003',
  'identify', 'leased', 1, 50, now() - interval '2 minutes',
  '80000000-dddd-4000-8000-000000000008', now() - interval '1 minute');
create temp table saturated_claim as select *
from public.claim_connector_oauth_identities(now(), 1, 60);
select ok((select count(*) = 1 and bool_and(job.attempt_count = 50)
  from saturated_claim join app_private.connector_oauth_lifecycle_jobs job
    on job.id = saturated_claim.job_id)
  and (select lease_token from saturated_claim) <>
    '80000000-dddd-4000-8000-000000000008',
  'attempt-fifty reusable identity lease is reclaimed without overflow');
select is((select public.fail_connector_oauth_identity(
  job_id, '80000000-dddd-4000-8000-000000000008', 'provider_timeout', true, now())
  from saturated_claim), false, 'the fenced lease cannot release a reclaimed job');
select ok((select public.fail_connector_oauth_identity(
  job_id, lease_token, 'provider_timeout', true, now()) from saturated_claim),
  'retryable identity failure releases the saturated lease');
select ok((select state = 'pending' and attempt_count = 50 and next_attempt_at > now()
  from app_private.connector_oauth_lifecycle_jobs
  where id = '70000000-dddd-4000-8000-000000000007'),
  'retryable failure remains recoverable at the attempt ceiling');
create temp table final_claim as select * from public.claim_connector_oauth_identities(
  (select next_attempt_at + interval '1 second'
   from app_private.connector_oauth_lifecycle_jobs
   where id = '70000000-dddd-4000-8000-000000000007'), 1, 60);
select ok((select count(*) = 1 from final_claim)
  and (select lease_token from final_claim) <> (select lease_token from saturated_claim),
  'released saturated work receives a fresh lease');
select ok((select public.fail_connector_oauth_identity(
  job_id, lease_token, 'invalid_grant', false, now()) from final_claim),
  'explicit nonretryable identity failure is accepted');
select ok((select state = 'permanent_failure' and last_error_code = 'invalid_grant'
  from app_private.connector_oauth_lifecycle_jobs
  where id = '70000000-dddd-4000-8000-000000000007'),
  'explicit permanent failure retains a safe terminal marker');
select * from finish();
rollback;
