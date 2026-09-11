begin;
create extension if not exists pgtap with schema extensions;
set search_path = extensions, public, pg_catalog;
select plan(33);

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

insert into public.brands (id, slug, name) values
  ('10000000-eeee-4000-8000-000000000001', 'oauth-provider-race', 'Provider race');
create temp table provider_reference as select public.store_connector_secret(
  '10000000-eeee-4000-8000-000000000001', 'slack',
  '{"access_token":"provider-old-access","refresh_token":"provider-old-refresh","external_account_id":"provider-race-account"}',
  'Provider race', array['chat:write'], now() + interval '1 hour') reference_id;
update public.credential_references reference set external_account_fingerprint =
  app.connector_external_account_fingerprint(reference.provider_id, secret.decrypted_secret)
from vault.decrypted_secrets secret where secret.id = reference.vault_secret_id
  and reference.id = (select reference_id from provider_reference);
insert into public.connector_installations (
  id, brand_id, provider_id, credential_reference_id, status, enabled_capabilities, settings
) select '20000000-eeee-4000-8000-000000000002',
  '10000000-eeee-4000-8000-000000000001', provider.id, reference.reference_id,
  'connected_healthy', array['alerts.write'], '{"oauthRequestedScopes":["chat:write"]}'
from public.connector_registry provider cross join provider_reference reference
where provider.provider_key = 'slack';
insert into app_private.connector_oauth_lifecycle_jobs (
  id, brand_id, installation_id, credential_reference_id, provider_id,
  operation, credential_generation, next_attempt_at
) select '30000000-eeee-4000-8000-000000000003',
  '10000000-eeee-4000-8000-000000000001', '20000000-eeee-4000-8000-000000000002',
  reference.reference_id, provider.id, 'refresh', 1, now()
from public.connector_registry provider cross join provider_reference reference
where provider.provider_key = 'slack';
create temp table provider_refresh_claim as
select * from public.claim_connector_oauth_refreshes(now(), 1, 60);
select is((select count(*) from provider_refresh_claim), 1::bigint,
  'provider-race refresh is leased');

update public.connector_registry set availability = 'disabled' where provider_key = 'slack';
select ok((select status = 'disabled' and cardinality(enabled_capabilities) = 0
    and credential_reference_id is not null from public.connector_installations
  where id = '20000000-eeee-4000-8000-000000000002'),
  'provider disable removes local access while retaining the pointer');
select ok((select revoked_at is not null from public.credential_references
  where id = (select reference_id from provider_reference)),
  'provider disable revokes ordinary secret resolution');
select is((select count(*) from vault.secrets secret join public.credential_references reference
  on reference.vault_secret_id = secret.id
  where reference.id = (select reference_id from provider_reference)), 1::bigint,
  'provider disable retains Vault evidence for cleanup');
select ok((select state = 'pending' and credential_generation = 1
  from app_private.connector_oauth_lifecycle_jobs
  where credential_reference_id = (select reference_id from provider_reference)
    and operation = 'revoke'), 'provider disable queues revocation');
select ok((select public.start_connector_oauth_credential_rotation(job_id,lease_token,now()) from provider_refresh_claim),'late refresh records provider rotation intent');
select ok((select public.complete_connector_oauth_refresh(job_id, lease_token,
  '{"access_token":"provider-new-access","refresh_token":"provider-new-refresh","external_account_id":"provider-race-account"}',
  now() + interval '2 hours', now()) from provider_refresh_claim),
  'late provider response is persisted for revocation');
select is((select status from public.connector_installations
  where id = '20000000-eeee-4000-8000-000000000002'), 'disabled',
  'refresh finalize preserves provider-disabled status');
select ok((select credential_generation = 2 and revoked_at is not null
  from public.credential_references where id = (select reference_id from provider_reference)),
  'disabled reference advances to the returned generation and stays revoked');
select ok((select state = 'cancelled' and last_finished_outcome = 'compensated'
  from app_private.connector_oauth_lifecycle_jobs
  where id = '30000000-eeee-4000-8000-000000000003'),
  'disabled refresh is terminally compensated');
select ok((select state = 'pending' and attempt_count = 0 and credential_generation = 2
  from app_private.connector_oauth_lifecycle_jobs
  where credential_reference_id = (select reference_id from provider_reference)
    and operation = 'revoke'), 'revocation follows the rotated generation');
select is((select count(*) from public.claim_connector_oauth_refreshes(now(), 1, 60)),
  0::bigint, 'disabled installation has no usable refresh claim');
create temp table provider_revoke_claim as
select * from public.claim_connector_oauth_revocations(now(), 1, 60);
select is((select count(*) from provider_revoke_claim), 1::bigint,
  'disabled credential can be claimed for cleanup');
select is((select credential->>'access_token' from provider_revoke_claim),
  'provider-new-access', 'cleanup receives the persisted rotated credential');
select ok((select public.complete_connector_oauth_revocation(job_id, lease_token, now())
  from provider_revoke_claim), 'provider cleanup finalizes');
select ok((select credential_reference_id is null from public.connector_installations
  where id = '20000000-eeee-4000-8000-000000000002'),
  'cleanup clears a disabled installation pointer');
select is((select count(*) from vault.secrets secret join public.credential_references reference
  on reference.vault_secret_id = secret.id
  where reference.id = (select reference_id from provider_reference)), 0::bigint,
  'cleanup deletes Vault data only after provider success');

update public.connector_registry set availability = 'available' where provider_key = 'slack';
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('40000000-eeee-4000-8000-000000000004', 'reconnect-owner@example.test', '{}', '{}');
insert into public.brands (id, slug, name) values
  ('50000000-eeee-4000-8000-000000000005', 'oauth-reconnect-race', 'Reconnect race');
insert into public.brand_users (user_id, brand_id, role) values
  ('40000000-eeee-4000-8000-000000000004',
   '50000000-eeee-4000-8000-000000000005', 'brand_owner');
create temp table old_reference as select public.store_connector_secret(
  '50000000-eeee-4000-8000-000000000005', 'slack',
  '{"access_token":"reconnect-old-access","refresh_token":"reconnect-old-refresh","external_account_id":"reconnect-old-account"}',
  'Reconnect old', array['chat:write'], now() + interval '1 hour') reference_id;
update public.credential_references reference set external_account_fingerprint =
  app.connector_external_account_fingerprint(reference.provider_id, secret.decrypted_secret)
from vault.decrypted_secrets secret where secret.id = reference.vault_secret_id
  and reference.id = (select reference_id from old_reference);
insert into public.connector_installations (
  id, brand_id, provider_id, credential_reference_id, status, enabled_capabilities, settings
) select '60000000-eeee-4000-8000-000000000006',
  '50000000-eeee-4000-8000-000000000005', provider.id, reference.reference_id,
  'connected_healthy', array['alerts.write'], '{"oauthRequestedScopes":["chat:write"]}'
from public.connector_registry provider cross join old_reference reference
where provider.provider_key = 'slack';
insert into app_private.connector_oauth_lifecycle_jobs (
  id, brand_id, installation_id, credential_reference_id, provider_id,
  operation, credential_generation, next_attempt_at
) select '70000000-eeee-4000-8000-000000000007',
  '50000000-eeee-4000-8000-000000000005', '60000000-eeee-4000-8000-000000000006',
  reference.reference_id, provider.id, 'refresh', 1, now()
from public.connector_registry provider cross join old_reference reference
where provider.provider_key = 'slack';
create temp table old_refresh_claim as
select * from public.claim_connector_oauth_refreshes(now(), 1, 60);
select is((select count(*) from old_refresh_claim), 1::bigint,
  'old reconnect credential is leased');
select throws_ok($test$select public.begin_connector_oauth_state(
  '50000000-eeee-4000-8000-000000000005', 'slack',
  '40000000-eeee-4000-8000-000000000004', repeat('7',64), repeat('8',64),
  array['chat:write'], 'https://hq.example.test/slack/callback',
  now() + interval '10 minutes')$test$, '55000', 'connector_oauth_refresh_in_progress',
  'reconnect cannot race a leased refresh');
select ok((select state = 'leased' from app_private.connector_oauth_lifecycle_jobs
  where id = '70000000-eeee-4000-8000-000000000007') and
  (select credential_reference_id = (select reference_id from old_reference)
   from public.connector_installations where id = '60000000-eeee-4000-8000-000000000006'),
  'blocked reconnect leaves the lease and installation pointer unchanged');
select ok((select public.fail_connector_oauth_refresh(
  job_id, lease_token, 'provider_timeout', true, now()) from old_refresh_claim),
  'the old refresh lease releases through its durable failure path');
select is((public.begin_connector_oauth_state(
  '50000000-eeee-4000-8000-000000000005', 'slack',
  '40000000-eeee-4000-8000-000000000004', repeat('7',64), repeat('8',64),
  array['chat:write'], 'https://hq.example.test/slack/callback',
  now() + interval '10 minutes')->>'status'), 'revocation_pending',
  'grant-scoped reconnect first queues revocation');
select ok((select status = 'revoked' and credential_reference_id =
    (select reference_id from old_reference) from public.connector_installations
  where id = '60000000-eeee-4000-8000-000000000006'),
  'reconnect disables local access while retaining cleanup evidence');
select ok((select revoked_at is not null from public.credential_references
  where id = (select reference_id from old_reference)) and
  (select state = 'cancelled' from app_private.connector_oauth_lifecycle_jobs
   where id = '70000000-eeee-4000-8000-000000000007'),
  'disconnect revokes the reference and cancels refresh retries');
create temp table old_revoke_claim as
select * from public.claim_connector_oauth_revocations(now(), 1, 60);
select is((select count(*) from old_revoke_claim), 1::bigint,
  'ordered reconnect claims exactly one revocation');
select is((select credential->>'access_token' from old_revoke_claim),
  'reconnect-old-access', 'revocation resolves the original credential');
select ok((select public.complete_connector_oauth_revocation(job_id, lease_token, now())
  from old_revoke_claim), 'original grant revocation completes');
select ok((select credential_reference_id is null from public.connector_installations
  where id = '60000000-eeee-4000-8000-000000000006'),
  'revocation clears the original pointer');
select is((select count(*) from vault.secrets secret join public.credential_references reference
  on reference.vault_secret_id = secret.id
  where reference.id = (select reference_id from old_reference)), 0::bigint,
  'revocation removes the original Vault credential');
select is((public.begin_connector_oauth_state(
  '50000000-eeee-4000-8000-000000000005', 'slack',
  '40000000-eeee-4000-8000-000000000004', repeat('7',64), repeat('8',64),
  array['chat:write'], 'https://hq.example.test/slack/callback',
  now() + interval '10 minutes')->>'status'), 'authorization_ready',
  'reconnect can begin after cleanup succeeds');
select is((select count(*) from public.consume_connector_oauth_state(
  'slack', '40000000-eeee-4000-8000-000000000004', repeat('7',64),
  repeat('8',64), '80000000-eeee-4000-8000-000000000008')), 1::bigint,
  'reconnect consumes with the stable completion key');
select ok(public.start_connector_oauth_code_exchange((select id from app_private.connector_oauth_states where consume_key='80000000-eeee-4000-8000-000000000008'),'80000000-eeee-4000-8000-000000000008',(select processing_lease_token from app_private.connector_oauth_states where consume_key='80000000-eeee-4000-8000-000000000008'),'81000000-eeee-4000-8000-000000000008',now()),'reconnect callback owns the token exchange');
select ok(public.complete_connector_oauth_connection(
  '50000000-eeee-4000-8000-000000000005',
  '60000000-eeee-4000-8000-000000000006', 'slack',
  '40000000-eeee-4000-8000-000000000004',
  '80000000-eeee-4000-8000-000000000008',
  '{"access_token":"reconnect-current-access","refresh_token":"reconnect-current-refresh","external_account_id":"reconnect-current-account"}',
  'Reconnect current', array['chat:write'], now() + interval '1 hour') is not null,
  'reconnect installs a new identity after ordered cleanup');

select * from finish();
rollback;
