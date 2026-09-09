begin;
create extension if not exists pgtap with schema extensions;
set search_path = extensions, public, pg_catalog;
select plan(47);

select has_column('public', 'square_connections', 'oauth_scope_contract_version',
  'Square connections record the scope contract they proved');
select col_default_is('public', 'square_connections', 'oauth_scope_contract_version', '1',
  'legacy Square grants default to contract version one');
select has_column('public', 'location_square_status', 'oauth_scope_contract_version',
  'owner status exposes the Square scope contract');
select has_function('public', 'reconcile_connector_credential_status',
  array['timestamptz','integer'], 'credential reconciliation exists');
select has_function('public', 'disconnect_connector_oauth_connection',
  array['uuid','text','uuid'], 'connector disconnect exists');
select ok(not has_function_privilege('anon',
  'public.reconcile_connector_credential_status(timestamptz,integer)', 'EXECUTE'),
  'anon cannot reconcile connector credentials');
select ok(not has_function_privilege('authenticated',
  'public.reconcile_connector_credential_status(timestamptz,integer)', 'EXECUTE'),
  'authenticated clients cannot reconcile connector credentials');
select ok(has_function_privilege('service_role',
  'public.reconcile_connector_credential_status(timestamptz,integer)', 'EXECUTE'),
  'service role can reconcile connector credentials');
select ok(not has_function_privilege('anon',
  'public.disconnect_connector_oauth_connection(uuid,text,uuid)', 'EXECUTE'),
  'anon cannot disconnect a connector');
select ok(not has_function_privilege('authenticated',
  'public.disconnect_connector_oauth_connection(uuid,text,uuid)', 'EXECUTE'),
  'authenticated clients cannot bypass the disconnect route');
select ok(has_function_privilege('service_role',
  'public.disconnect_connector_oauth_connection(uuid,text,uuid)', 'EXECUTE'),
  'service role can call the owner-authorized disconnect boundary');
select throws_ok(
  $$select public.reconcile_connector_credential_status(now(), 0)$$,
  '22023', 'connector_reconcile_limit_invalid', 'reconcile rejects an empty batch');
select throws_ok(
  $$select public.reconcile_connector_credential_status(now(), 501)$$,
  '22023', 'connector_reconcile_limit_invalid', 'reconcile rejects an oversized batch');
select throws_ok(
  $$select public.reconcile_connector_credential_status(null, 100)$$,
  '22023', 'connector_reconcile_time_invalid', 'reconcile rejects an unknown clock');

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('81818181-8181-4818-8818-818181818181', 'lifecycle-owner@example.test', '{}', '{}'),
  ('82828282-8282-4828-8828-828282828282', 'lifecycle-outsider@example.test', '{}', '{}');
insert into public.brands (id, slug, name) values
  ('83838383-8383-4838-8838-838383838383', 'credential-lifecycle-test', 'Credential Lifecycle');
insert into public.brand_users (user_id, brand_id, role) values
  ('81818181-8181-4818-8818-818181818181',
   '83838383-8383-4838-8838-838383838383', 'brand_owner');
insert into public.connector_registry (
  id, provider_key, display_name, category, availability,
  logo_path, logo_source_url, logo_license
) values
  ('84848484-8484-4848-8848-848484848484', 'lifecycle-oauth-test',
   'Lifecycle OAuth', 'platform', 'available', '/test.svg', 'https://example.test/logo.svg', 'test'),
  ('85858585-8585-4858-8858-858585858585', 'lifecycle-stale-test',
   'Lifecycle Stale', 'platform', 'available', '/test.svg', 'https://example.test/logo.svg', 'test');
insert into public.connector_capabilities (
  id, provider_id, capability_key, display_name, access_mode, oauth_scopes
) values (
  '86868686-8686-4868-8868-868686868686',
  '84848484-8484-4848-8848-848484848484',
  'profile.read', 'Profile read', 'read', array['profile.read']
);
insert into public.connector_certifications (
  capability_id, environment, status, contract_version, certified_at, valid_until
) values (
  '86868686-8686-4868-8868-868686868686', 'sandbox', 'passed', '1.0.0',
  now(), now() + interval '1 day'
);
insert into public.connector_installations (
  id, brand_id, provider_id, status, connected_by
) values
  ('10101010-1010-4010-8010-101010101010',
   '83838383-8383-4838-8838-838383838383',
   '84848484-8484-4848-8848-848484848484', 'connecting',
   '81818181-8181-4818-8818-818181818181'),
  ('20202020-2020-4020-8020-202020202020',
   '83838383-8383-4838-8838-838383838383',
   '85858585-8585-4858-8858-858585858585', 'connecting',
   '81818181-8181-4818-8818-818181818181');

select is(public.reconcile_connector_credential_status(now(), 1), 1,
  'one batch changes at most its requested total across stale states');
select is((select count(*) from public.connector_installations where status = 'connecting'),
  1::bigint, 'one stale installation remains after a one-row batch');
select is(public.reconcile_connector_credential_status(now(), 100), 1,
  'the next batch drains the remaining stale installation');
select is((select count(*) from public.connector_installations where status = 'setup_required'),
  2::bigint, 'abandoned first-time grants return to setup');
select is((select count(*) from public.connector_audit_events
  where brand_id = '83838383-8383-4838-8838-838383838383'
    and action = 'credential.status_changed'), 2::bigint,
  'stale grant recovery is audited');
select ok((select bool_and(
    detail->>'previousStatus' = 'connecting'
    and detail->>'status' = 'setup_required'
  ) from public.connector_audit_events
  where brand_id = '83838383-8383-4838-8838-838383838383'
    and action = 'credential.status_changed'),
  'stale grant audits record both sides of the transition');

select lives_ok($test$select public.begin_connector_oauth_state(
  '83838383-8383-4838-8838-838383838383', 'lifecycle-oauth-test',
  '81818181-8181-4818-8818-818181818181', repeat('8', 64), repeat('9', 64),
  array['profile.read'], 'https://hq.example.test/api/connectors/lifecycle-oauth-test/callback',
  now() + interval '10 minutes')$test$, 'an owner can restart setup');
select is((select count(*) from public.consume_connector_oauth_state(
  'lifecycle-oauth-test', '81818181-8181-4818-8818-818181818181', repeat('8', 64))),
  1::bigint, 'the restarted state is consumed');
select lives_ok($test$select public.complete_connector_oauth_connection(
  '83838383-8383-4838-8838-838383838383',
  '10101010-1010-4010-8010-101010101010', 'lifecycle-oauth-test',
  '81818181-8181-4818-8818-818181818181',
  '{"access_token":"credential-lifecycle-token"}', 'Lifecycle Account',
  array['profile.read'], now() + interval '30 days')$test$,
  'a complete scope grant becomes healthy');
select is((select status from public.connector_installations
  where id = '10101010-1010-4010-8010-101010101010'), 'connected_healthy',
  'a fresh complete credential is healthy');
select is((select settings->'oauthRequestedScopes' from public.connector_installations
  where id = '10101010-1010-4010-8010-101010101010'), '["profile.read"]'::jsonb,
  'the durable scope contract is retained for reconciliation');
update public.connector_capabilities set oauth_scopes = array['profile.read', 'profile.write']
where id = '86868686-8686-4868-8868-868686868686';
select is(public.reconcile_connector_credential_status(now(), 100), 1,
  'reconcile detects a capability whose current scope contract has expanded');
select is((select status from public.connector_installations
  where id = '10101010-1010-4010-8010-101010101010'), 'reauthorization_required',
  'a credential missing a newly required capability scope needs reauthorization');
update public.connector_capabilities set oauth_scopes = array['profile.read']
where id = '86868686-8686-4868-8868-868686868686';
update public.connector_installations set
  status = 'connected_healthy', enabled_capabilities = array['profile.read']
where id = '10101010-1010-4010-8010-101010101010';
select lives_ok($test$select public.begin_connector_oauth_state(
  '83838383-8383-4838-8838-838383838383', 'lifecycle-oauth-test',
  '81818181-8181-4818-8818-818181818181', repeat('a', 64), repeat('b', 64),
  array['profile.read'], 'https://hq.example.test/api/connectors/lifecycle-oauth-test/callback',
  now() + interval '10 minutes')$test$, 'reauthorization can begin without hiding a durable credential');
select is((select status from public.connector_installations
  where id = '10101010-1010-4010-8010-101010101010'), 'connected_healthy',
  'starting reauthorization preserves the credential-backed status');

update app_private.connector_oauth_states set
  created_at = now() - interval '2 hours',
  expires_at = now() - interval '1 hour',
  consumed_at = case when consumed_at is null then null else now() - interval '90 minutes' end
where installation_id = '10101010-1010-4010-8010-101010101010';
update public.connector_installations set status = 'connecting'
where id = '10101010-1010-4010-8010-101010101010';
select is(public.reconcile_connector_credential_status(now(), 100), 1,
  'an abandoned reauthorization with a durable credential is reconciled once');
select is((select status from public.connector_installations
  where id = '10101010-1010-4010-8010-101010101010'), 'reauthorization_required',
  'an abandoned reauthorization retains the durable credential but requires consent');
update public.connector_installations set
  status = 'connected_healthy', enabled_capabilities = array['profile.read']
where id = '10101010-1010-4010-8010-101010101010';
update public.credential_references set expires_at = now() - interval '1 minute'
where brand_id = '83838383-8383-4838-8838-838383838383';
select is(public.reconcile_connector_credential_status(now(), 100), 1,
  'an expired durable credential is reconciled once');
select is((select status from public.connector_installations
  where id = '10101010-1010-4010-8010-101010101010'), 'reauthorization_required',
  'an expired credential requires reauthorization');
select lives_ok($test$select public.begin_connector_oauth_state(
  '83838383-8383-4838-8838-838383838383', 'lifecycle-oauth-test',
  '81818181-8181-4818-8818-818181818181', repeat('c', 64), repeat('d', 64),
  array['profile.read'], 'https://hq.example.test/api/connectors/lifecycle-oauth-test/callback',
  now() + interval '10 minutes')$test$, 'an owner can begin a fresh credential replacement');
select is((select count(*) from public.consume_connector_oauth_state(
  'lifecycle-oauth-test', '81818181-8181-4818-8818-818181818181', repeat('c', 64))),
  1::bigint, 'the replacement state reaches the consumed callback phase');
select throws_ok($test$select public.disconnect_connector_oauth_connection(
  '83838383-8383-4838-8838-838383838383', 'lifecycle-oauth-test',
  '82828282-8282-4828-8828-828282828282')$test$,
  '42501', 'connector_oauth_forbidden', 'a non-owner cannot disconnect');
select ok(public.disconnect_connector_oauth_connection(
  '83838383-8383-4838-8838-838383838383', 'lifecycle-oauth-test',
  '81818181-8181-4818-8818-818181818181'), 'an owner can disconnect');
select ok(public.disconnect_connector_oauth_connection(
  '83838383-8383-4838-8838-838383838383', 'lifecycle-oauth-test',
  '81818181-8181-4818-8818-818181818181'), 'disconnect is idempotent');
select throws_ok($test$select public.complete_connector_oauth_connection(
  '83838383-8383-4838-8838-838383838383',
  '10101010-1010-4010-8010-101010101010', 'lifecycle-oauth-test',
  '81818181-8181-4818-8818-818181818181',
  '{"access_token":"credential-resurrection-token"}', 'Resurrection Attempt',
  array['profile.read'], now() + interval '30 days')$test$,
  '22023', 'connector_oauth_state_incomplete',
  'a callback consumed before disconnect cannot resurrect the credential');
select ok((select status = 'revoked' and credential_reference_id is null
  from public.connector_installations
  where id = '10101010-1010-4010-8010-101010101010'),
  'disconnect clears the public pointer and marks the installation revoked');
select ok((select bool_and(revoked_at is not null) from public.credential_references
  where brand_id = '83838383-8383-4838-8838-838383838383'),
  'disconnect revokes the credential reference');
select is((select count(*) from vault.secrets secret
  join public.credential_references reference on reference.vault_secret_id = secret.id
  where reference.brand_id = '83838383-8383-4838-8838-838383838383'),
  0::bigint, 'disconnect deletes the Vault secret');
select is((select count(*) from public.connector_audit_events
  where brand_id = '83838383-8383-4838-8838-838383838383'
    and action = 'oauth.disconnected'), 1::bigint,
  'disconnect writes one idempotent audit event');
select ok((select detail @> '{"credentialReferenceRevoked":true,"vaultSecretAbsent":true}'::jsonb
  from public.connector_audit_events
  where brand_id = '83838383-8383-4838-8838-838383838383'
    and action = 'oauth.disconnected'),
  'disconnect audit confirms both reference revocation and Vault absence');

insert into public.locations (id, brand_id, name) values
  ('87878787-8787-4878-8878-878787878787',
   '83838383-8383-4838-8838-838383838383', 'Legacy Square'),
  ('88888888-8888-4888-8888-888888888888',
   '83838383-8383-4838-8838-838383838383', 'Current Square');
insert into public.square_connections (
  brand_id, location_id, merchant_id, square_location_id,
  access_token_encrypted, refresh_token_encrypted, expires_at,
  oauth_scope_contract_version
) values
  ('83838383-8383-4838-8838-838383838383', '87878787-8787-4878-8878-878787878787',
   'legacy-merchant', 'legacy-location', 'legacy-access', 'legacy-refresh',
   now() + interval '1 day', 1),
  ('83838383-8383-4838-8838-838383838383', '88888888-8888-4888-8888-888888888888',
   'current-merchant', 'current-location', 'current-access', 'current-refresh',
   now() + interval '1 day', 2);
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', '81818181-8181-4818-8818-818181818181',
  'role', 'authenticated',
  'app_metadata', jsonb_build_object(
    'role', 'brand_owner', 'brand_id', '83838383-8383-4838-8838-838383838383'
  ))::text, true);
select is((select count(*) from public.location_square_status
  where brand_id = '83838383-8383-4838-8838-838383838383'), 2::bigint,
  'owners can see both legacy and current Square connections');
select is((select min(oauth_scope_contract_version) from public.location_square_status
  where brand_id = '83838383-8383-4838-8838-838383838383'), 1,
  'legacy Square grants remain visible for reauthorization and disconnect');
select is((select max(oauth_scope_contract_version) from public.location_square_status
  where brand_id = '83838383-8383-4838-8838-838383838383'), 2,
  'current Square grants expose the proven scope contract');

select * from finish();
rollback;
