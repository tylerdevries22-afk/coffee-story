begin;
create extension if not exists pgtap with schema extensions;
set search_path = extensions, public, pg_catalog;
select plan(22);

select has_function('public', 'claim_connector_oauth_revocations',
  array['timestamptz','integer','integer'], 'revocation claim RPC exists');
select has_function('public', 'rotate_connector_oauth_revocation_credential',
  array['uuid','uuid','jsonb','timestamptz','timestamptz'], 'revocation rotation RPC exists');
select has_function('public', 'complete_connector_oauth_revocation',
  array['uuid','uuid','timestamptz'], 'revocation finalize RPC exists');
select has_function('public', 'fail_connector_oauth_revocation',
  array['uuid','uuid','text','boolean','timestamptz'], 'revocation failure RPC exists');
select has_function('public', 'claim_connector_oauth_refreshes',
  array['timestamptz','integer','integer'], 'refresh claim RPC exists');
select has_function('public', 'complete_connector_oauth_refresh',
  array['uuid','uuid','jsonb','timestamptz','timestamptz'], 'refresh finalize RPC exists');
select has_function('public', 'fail_connector_oauth_refresh',
  array['uuid','uuid','text','boolean','timestamptz'], 'refresh failure RPC exists');

create temp table lifecycle_signatures(signature text) on commit drop;
insert into lifecycle_signatures values
  ('public.claim_connector_oauth_revocations(timestamptz,integer,integer)'),
  ('public.rotate_connector_oauth_revocation_credential(uuid,uuid,jsonb,timestamptz,timestamptz)'),
  ('public.complete_connector_oauth_revocation(uuid,uuid,timestamptz)'),
  ('public.fail_connector_oauth_revocation(uuid,uuid,text,boolean,timestamptz)'),
  ('public.claim_connector_oauth_refreshes(timestamptz,integer,integer)'),
  ('public.complete_connector_oauth_refresh(uuid,uuid,jsonb,timestamptz,timestamptz)'),
  ('public.fail_connector_oauth_refresh(uuid,uuid,text,boolean,timestamptz)');
select ok((select bool_and(
    not has_function_privilege('anon', signature, 'EXECUTE')
    and not has_function_privilege('authenticated', signature, 'EXECUTE')
  ) from lifecycle_signatures), 'client roles cannot execute lifecycle workers');
select ok((select bool_and(has_function_privilege('service_role', signature, 'EXECUTE'))
  from lifecycle_signatures), 'service role can execute every lifecycle worker');
select ok(not has_table_privilege('service_role',
  'app_private.connector_oauth_lifecycle_jobs', 'SELECT'),
  'service role cannot inspect the private queue directly');
select ok(not has_table_privilege('authenticated',
  'app_private.connector_oauth_lifecycle_jobs', 'SELECT'),
  'authenticated clients cannot inspect the private queue');
select ok((select relrowsecurity and relforcerowsecurity from pg_class
  where oid = 'app_private.connector_oauth_lifecycle_jobs'::regclass),
  'the private lifecycle queue forces RLS');

insert into public.brands (id, slug, name) values
  ('10000000-bbbb-4000-8000-000000000001', 'oauth-failure-test', 'OAuth Failure');
insert into public.connector_registry (
  id, provider_key, display_name, category, availability,
  logo_path, logo_source_url, logo_license, oauth_lifecycle_managed,
  oauth_refresh_managed, oauth_revocation_scope, oauth_grant_namespace
) values ('20000000-bbbb-4000-8000-000000000002', 'oauth-failure-test',
  'OAuth Failure', 'platform', 'available', '/test.svg',
  'https://example.test/logo.svg', 'test', true, false, 'credential',
  'oauth-failure-test');
select public.store_connector_secret(
  '10000000-bbbb-4000-8000-000000000001', 'oauth-failure-test',
  '{"access_token":"failure-access-token","external_account_id":"failure-account"}',
  'Failure', '{}', now() + interval '1 day'
) as reference_id \gset
update public.credential_references set
  external_account_fingerprint = app.connector_external_account_fingerprint(
    '20000000-bbbb-4000-8000-000000000002',
    '{"access_token":"failure-access-token","external_account_id":"failure-account"}'
  ),
  revoked_at = now()
where id = :'reference_id';
insert into public.connector_installations (
  id, brand_id, provider_id, credential_reference_id, status
) values ('30000000-bbbb-4000-8000-000000000003',
  '10000000-bbbb-4000-8000-000000000001',
  '20000000-bbbb-4000-8000-000000000002', :'reference_id', 'revoked');
insert into app_private.connector_oauth_lifecycle_jobs (
  id, brand_id, installation_id, credential_reference_id, provider_id,
  operation, credential_generation, next_attempt_at
) values ('40000000-bbbb-4000-8000-000000000004',
  '10000000-bbbb-4000-8000-000000000001',
  '30000000-bbbb-4000-8000-000000000003', :'reference_id',
  '20000000-bbbb-4000-8000-000000000002', 'revoke', 1, now());
create temp table failed_claim as select *
from public.claim_connector_oauth_revocations(now(), 1, 60);
select is((select count(*) from failed_claim), 1::bigint,
  'permanent-error fixture receives one lease');
select is((select public.complete_connector_oauth_revocation(
  job_id, gen_random_uuid(), now()) from failed_claim), false,
  'an unrelated lease cannot complete the job');
select ok((select public.fail_connector_oauth_revocation(
  job_id, lease_token, 'invalid_grant', false, now()) from failed_claim),
  'nonretryable provider failure is finalized');
select ok((select public.fail_connector_oauth_revocation(
  job_id, lease_token, 'invalid_grant', false, now()) from failed_claim),
  'lost permanent-failure response is replayable');
select is((select public.fail_connector_oauth_revocation(
  job_id, lease_token, 'provider_timeout', true, now()) from failed_claim), false,
  'changed permanent-failure payload is not replayable');
select ok((select state = 'permanent_failure' and last_error_code = 'invalid_grant'
  from app_private.connector_oauth_lifecycle_jobs
  where id = '40000000-bbbb-4000-8000-000000000004'),
  'nonretryable failure records only a safe error marker');
select is((select count(*) from vault.secrets secret
  join public.credential_references reference on reference.vault_secret_id = secret.id
  where reference.id = :'reference_id'), 1::bigint,
  'permanent revocation failure retains Vault evidence');

update app_private.connector_oauth_lifecycle_jobs set
  state = 'leased', attempt_count = 50,
  lease_token = '50000000-bbbb-4000-8000-000000000005',
  lease_expires_at = now() - interval '1 minute',
  last_finished_lease_token = null, last_error_code = null, completed_at = null
where id = '40000000-bbbb-4000-8000-000000000004';
create temp table saturated_reclaim as select *
from public.claim_connector_oauth_revocations(now(), 1, 60);
select ok((select count(*) = 1 from saturated_reclaim)
  and (select lease_token from saturated_reclaim) <>
    '50000000-bbbb-4000-8000-000000000005',
  'a reusable attempt-fifty lease is reclaimed with a fresh token');
select ok((select state = 'leased' and attempt_count = 50
    and last_error_code is null
  from app_private.connector_oauth_lifecycle_jobs
  where id = '40000000-bbbb-4000-8000-000000000004'),
  'retryable attempt count saturates without terminalizing the job');
select throws_ok($test$select public.fail_connector_oauth_revocation(
  '40000000-bbbb-4000-8000-000000000004', gen_random_uuid(), 'Unsafe Detail!', true, now())$test$,
  '22023', 'connector_oauth_failure_invalid', 'unsafe provider detail is rejected');
select * from finish();
rollback;
