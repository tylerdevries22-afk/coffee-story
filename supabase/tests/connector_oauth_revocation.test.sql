begin;
create extension if not exists pgtap with schema extensions;
set search_path = extensions, public, pg_catalog;
select plan(32);

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('11111111-aaaa-4111-8111-111111111111', 'revoke-owner@example.test', '{}', '{}'),
  ('22222222-aaaa-4222-8222-222222222222', 'revoke-outsider@example.test', '{}', '{}');
insert into public.brands (id, slug, name) values
  ('33333333-aaaa-4333-8333-333333333333', 'oauth-revoke-test', 'OAuth Revoke');
insert into public.brand_users (user_id, brand_id, role) values
  ('11111111-aaaa-4111-8111-111111111111',
   '33333333-aaaa-4333-8333-333333333333', 'brand_owner');
insert into public.connector_registry (
  id, provider_key, display_name, category, availability,
  logo_path, logo_source_url, logo_license, oauth_lifecycle_managed,
  oauth_refresh_managed, oauth_revocation_scope, oauth_grant_namespace
) values ('44444444-aaaa-4444-8444-444444444444', 'oauth-revoke-test',
  'OAuth Revoke', 'platform', 'available', '/test.svg',
  'https://example.test/logo.svg', 'test', true, true, 'grant',
  'oauth-revoke-test');
insert into public.connector_capabilities (
  id, provider_id, capability_key, display_name, access_mode, oauth_scopes
) values ('55555555-aaaa-4555-8555-555555555555',
  '44444444-aaaa-4444-8444-444444444444',
  'profile.read', 'Profile read', 'read', array['profile.read']);
insert into public.connector_certifications (
  capability_id, environment, status, contract_version, certified_at, valid_until
) values ('55555555-aaaa-4555-8555-555555555555', 'sandbox', 'passed',
  '1.0.0', now(), now() + interval '1 day');

select lives_ok($test$select public.begin_connector_oauth_state(
  '33333333-aaaa-4333-8333-333333333333', 'oauth-revoke-test',
  '11111111-aaaa-4111-8111-111111111111', repeat('1',64), repeat('2',64),
  array['profile.read'], 'https://hq.example.test/oauth-revoke-test/callback',
  now() + interval '10 minutes')$test$, 'owner begins revocation fixture grant');
select is((select count(*) from public.consume_connector_oauth_state(
  'oauth-revoke-test', '11111111-aaaa-4111-8111-111111111111', repeat('1',64),
  repeat('2',64), '66666666-aaaa-4666-8666-666666666666')),
  1::bigint, 'grant state is consumed once');
select ok(public.start_connector_oauth_code_exchange(
  (select id from app_private.connector_oauth_states
   where consume_key = '66666666-aaaa-4666-8666-666666666666'),
  '66666666-aaaa-4666-8666-666666666666',
  (select processing_lease_token from app_private.connector_oauth_states
   where consume_key = '66666666-aaaa-4666-8666-666666666666'),
  '67676767-aaaa-4676-8676-676767676767', now()),
  'revocation fixture callback owns the token exchange');
select lives_ok($test$select public.complete_connector_oauth_connection(
  '33333333-aaaa-4333-8333-333333333333',
  (select id from public.connector_installations
   where brand_id = '33333333-aaaa-4333-8333-333333333333'),
  'oauth-revoke-test', '11111111-aaaa-4111-8111-111111111111',
  '66666666-aaaa-4666-8666-666666666666',
  '{"access_token":"initial-access-token","refresh_token":"initial-refresh-token","external_account_id":"revoke-account"}',
  'Revocation Account', array['profile.read'], now() + interval '30 days')$test$,
  'fixture credential is stored in Vault');
update public.credential_references set expires_at = now() - interval '1 minute'
where brand_id = '33333333-aaaa-4333-8333-333333333333';
select throws_ok($test$select public.disconnect_connector_oauth_connection(
  '33333333-aaaa-4333-8333-333333333333', 'oauth-revoke-test',
  '22222222-aaaa-4222-8222-222222222222')$test$,
  '42501', 'connector_oauth_forbidden', 'outsider cannot disconnect');
select ok(public.disconnect_connector_oauth_connection(
  '33333333-aaaa-4333-8333-333333333333', 'oauth-revoke-test',
  '11111111-aaaa-4111-8111-111111111111'), 'owner disables locally');
select ok(public.disconnect_connector_oauth_connection(
  '33333333-aaaa-4333-8333-333333333333', 'oauth-revoke-test',
  '11111111-aaaa-4111-8111-111111111111'), 'disconnect is idempotent');
select ok((select status = 'revoked' and credential_reference_id is not null
  from public.connector_installations
  where brand_id = '33333333-aaaa-4333-8333-333333333333'),
  'local access is revoked while the opaque pointer is retained');
select ok((select bool_and(revoked_at is not null) from public.credential_references
  where brand_id = '33333333-aaaa-4333-8333-333333333333'),
  'ordinary secret resolution is disabled');
select is((select count(*) from vault.secrets secret join public.credential_references reference
  on reference.vault_secret_id = secret.id
  where reference.brand_id = '33333333-aaaa-4333-8333-333333333333'), 1::bigint,
  'Vault retains the expired credential for upstream revocation');
select is((select count(*) from app_private.connector_oauth_lifecycle_jobs
  where brand_id = '33333333-aaaa-4333-8333-333333333333' and operation = 'revoke'),
  1::bigint, 'disconnect enqueues exactly one revoke job');
select is((select count(*) from public.connector_audit_events
  where brand_id = '33333333-aaaa-4333-8333-333333333333'
    and action = 'oauth.disconnected'), 1::bigint, 'disconnect audit is idempotent');

create temp table revoke_claim as select *
from public.claim_connector_oauth_revocations(now(), 1, 60);
select is((select count(*) from revoke_claim), 1::bigint, 'one revocation lease is claimed');
select is((select jsonb_typeof(credential) from revoke_claim), 'object',
  'claim securely resolves an expired and locally revoked credential');
select is((select public.complete_connector_oauth_revocation(
  job_id, '77777777-aaaa-4777-8777-777777777777', now()) from revoke_claim), false,
  'a wrong lease cannot finalize revocation');
select ok((select public.start_connector_oauth_credential_rotation(job_id,lease_token,now()) from revoke_claim),'revocation records provider rotation intent');
select ok((select public.rotate_connector_oauth_revocation_credential(
  job_id, lease_token,
  '{"access_token":"rotated-access-token","refresh_token":"rotated-refresh-token","external_account_id":"revoke-account"}',
  now() + interval '2 hours', now()) from revoke_claim),
  'revocation lease can persist a rotated credential');
select ok((select public.rotate_connector_oauth_revocation_credential(
  job_id, lease_token,
  '{"access_token":"rotated-access-token","refresh_token":"rotated-refresh-token","external_account_id":"revoke-account"}',
  now() + interval '2 hours', now()) from revoke_claim),
  'lost rotation response is replayable on the same lease');
select is((select public.rotate_connector_oauth_revocation_credential(
  job_id, lease_token,
  '{"access_token":"changed-access-token","refresh_token":"rotated-refresh-token","external_account_id":"revoke-account"}',
  now() + interval '2 hours', now()) from revoke_claim), false,
  'same lease cannot rotate to a different credential twice');
select ok((select reference.credential_generation = 2
    and job.credential_generation = 2
  from public.credential_references reference
  join app_private.connector_oauth_lifecycle_jobs job
    on job.credential_reference_id = reference.id
  where job.id = (select job_id from revoke_claim)),
  'Vault reference and revoke job advance one CAS generation');
select ok((select public.fail_connector_oauth_revocation(
  job_id, lease_token, 'provider_timeout', true, now()) from revoke_claim),
  'retryable upstream failure releases the lease');
select ok((select public.fail_connector_oauth_revocation(
  job_id, lease_token, 'provider_timeout', true, now()) from revoke_claim),
  'lost failure response is replayable');
select is((select public.fail_connector_oauth_revocation(
  job_id, lease_token, 'invalid_grant', false, now()) from revoke_claim), false,
  'changed revocation failure classification is not replayable');
select ok((select state = 'pending' and next_attempt_at > now()
  from app_private.connector_oauth_lifecycle_jobs
  where id = (select job_id from revoke_claim)), 'retry uses bounded backoff');
select is((select count(*) from public.claim_connector_oauth_revocations(now(), 1, 60)),
  0::bigint, 'backoff prevents an early retry claim');
create temp table revoke_reclaim as select *
from public.claim_connector_oauth_revocations(
  (select next_attempt_at + interval '1 second'
   from app_private.connector_oauth_lifecycle_jobs
   where id = (select job_id from revoke_claim)), 1, 60);
select ok((select count(*) = 1 from revoke_reclaim)
  and (select lease_token from revoke_reclaim) <>
    (select lease_token from revoke_claim),
  'retry receives a new lease token');
select is((select credential->>'access_token' from revoke_reclaim), 'rotated-access-token',
  'retry receives the durably rotated credential');
select ok((select public.complete_connector_oauth_revocation(
  job_id, lease_token, now()) from revoke_reclaim), 'current lease finalizes revocation');
select ok((select public.complete_connector_oauth_revocation(
  job_id, lease_token, now()) from revoke_reclaim), 'lost finalize response is replayable');
select is((select count(*) from vault.secrets secret join public.credential_references reference
  on reference.vault_secret_id = secret.id
  where reference.brand_id = '33333333-aaaa-4333-8333-333333333333'), 0::bigint,
  'Vault secret is deleted only after upstream revocation');
select ok((select credential_reference_id is null from public.connector_installations
  where brand_id = '33333333-aaaa-4333-8333-333333333333'),
  'successful revocation clears the public pointer');
select is((select state from app_private.connector_oauth_lifecycle_jobs
  where id = (select job_id from revoke_claim)), 'succeeded', 'job is terminally succeeded');
select * from finish();
rollback;
