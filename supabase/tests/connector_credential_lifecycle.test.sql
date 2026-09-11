begin;
create extension if not exists pgtap with schema extensions;
set search_path = extensions, public, pg_catalog;
select plan(24);

select has_column('public', 'square_connections', 'oauth_scope_contract_version',
  'Square connections record their scope contract');
select col_default_is('public', 'square_connections', 'oauth_scope_contract_version', '2',
  'new Square grants default to the current scope contract');
select has_column('public', 'location_square_status', 'oauth_scope_contract_version',
  'owner status exposes the Square contract');
select has_function('public', 'reconcile_connector_credential_status',
  array['timestamptz','integer'], 'credential reconciliation exists');
select has_function('public', 'disconnect_connector_oauth_connection',
  array['uuid','text','uuid'], 'connector disconnect exists');
select ok(not has_function_privilege('anon',
  'public.reconcile_connector_credential_status(timestamptz,integer)', 'EXECUTE'),
  'anon cannot reconcile credentials');
select ok(not has_function_privilege('authenticated',
  'public.reconcile_connector_credential_status(timestamptz,integer)', 'EXECUTE'),
  'authenticated clients cannot reconcile credentials');
select ok(has_function_privilege('service_role',
  'public.reconcile_connector_credential_status(timestamptz,integer)', 'EXECUTE'),
  'service role can reconcile credentials');
select throws_ok('select public.reconcile_connector_credential_status(now(), 0)',
  '22023', 'connector_reconcile_limit_invalid', 'zero batch is rejected');
select throws_ok('select public.reconcile_connector_credential_status(now(), 501)',
  '22023', 'connector_reconcile_limit_invalid', 'oversized batch is rejected');
select throws_ok('select public.reconcile_connector_credential_status(null, 100)',
  '22023', 'connector_reconcile_time_invalid', 'unknown clock is rejected');

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('81818181-8181-4818-8818-818181818181', 'lifecycle-owner@example.test', '{}', '{}');
insert into public.brands (id, slug, name) values
  ('83838383-8383-4838-8838-838383838383', 'credential-lifecycle-test', 'Lifecycle');
insert into public.brand_users (user_id, brand_id, role) values
  ('81818181-8181-4818-8818-818181818181',
   '83838383-8383-4838-8838-838383838383', 'brand_owner');
insert into public.connector_registry (
  id, provider_key, display_name, category, availability,
  logo_path, logo_source_url, logo_license,
  oauth_lifecycle_managed, oauth_revocation_scope, oauth_grant_namespace
) values
  ('84848484-8484-4848-8848-848484848484', 'lifecycle-oauth-test',
   'Lifecycle OAuth', 'platform', 'available', '/test.svg', 'https://example.test/logo.svg', 'test',
   true, 'credential', 'lifecycle-oauth-test'),
  ('85858585-8585-4858-8858-858585858585', 'lifecycle-stale-test',
   'Lifecycle Stale', 'platform', 'available', '/test.svg', 'https://example.test/logo.svg', 'test',
   true, 'credential', 'lifecycle-stale-test');
insert into public.connector_capabilities (
  id, provider_id, capability_key, display_name, access_mode, oauth_scopes
) values ('86868686-8686-4868-8868-868686868686',
  '84848484-8484-4848-8848-848484848484',
  'profile.read', 'Profile read', 'read', array['profile.read']);
insert into public.connector_certifications (
  id, capability_id, environment, status, contract_version, certified_at, valid_until
) values ('89898989-8989-4898-8898-898989898989',
  '86868686-8686-4868-8868-868686868686', 'sandbox', 'passed', '1.0.0',
  now(), now() + interval '1 day');
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
select throws_ok($test$update public.connector_capabilities
  set provider_id = '85858585-8585-4858-8858-858585858585'
  where id = '86868686-8686-4868-8868-868686868686'$test$,
  '23514', 'connector_capability_identity_immutable',
  'capability identity cannot move between providers');
select throws_ok($test$update public.connector_certifications
  set environment = 'production'
  where id = '89898989-8989-4898-8898-898989898989'$test$,
  '23514', 'connector_certification_identity_immutable',
  'certification identity cannot move between environments');

select is(public.reconcile_connector_credential_status(now(), 1), 1,
  'reconcile honors its row limit');
select is((select count(*) from public.connector_installations where status = 'connecting'),
  1::bigint, 'one stale installation remains after one row');
select is(public.reconcile_connector_credential_status(now(), 100), 1,
  'the next batch drains the remaining stale installation');
select is((select count(*) from public.connector_installations where status = 'setup_required'),
  2::bigint, 'abandoned grants return to setup');

select public.store_connector_secret(
  '83838383-8383-4838-8838-838383838383', 'lifecycle-oauth-test',
  '{"access_token":"lifecycle-access-token"}', 'Lifecycle',
  array['profile.read'], now() + interval '30 days') as reference_id \gset
update public.connector_installations set
  credential_reference_id = :'reference_id', status = 'connected_healthy',
  enabled_capabilities = array['profile.read'],
  settings = '{"oauthRequestedScopes":["profile.read"]}'
where id = '10101010-1010-4010-8010-101010101010';
update public.connector_capabilities set oauth_scopes = array['profile.read','profile.write']
where id = '86868686-8686-4868-8868-868686868686';
select is((select status from public.connector_installations
  where id = '10101010-1010-4010-8010-101010101010'), 'reauthorization_required',
  'a capability scope expansion invalidates the installation immediately');
update public.connector_capabilities set oauth_scopes = array['profile.read']
where id = '86868686-8686-4868-8868-868686868686';
update public.connector_installations set status = 'connected_healthy',
  enabled_capabilities = array['profile.read']
where id = '10101010-1010-4010-8010-101010101010';
update public.connector_certifications set status = 'failed'
where id = '89898989-8989-4898-8898-898989898989';
select is((select status from public.connector_installations
  where id = '10101010-1010-4010-8010-101010101010'), 'reauthorization_required',
  'certification invalidation immediately requires reauthorization');
update public.connector_certifications set status = 'passed'
where id = '89898989-8989-4898-8898-898989898989';
update public.connector_installations set status = 'connected_healthy',
  enabled_capabilities = array['profile.read']
where id = '10101010-1010-4010-8010-101010101010';
update public.connector_registry set availability = 'disabled'
where id = '84848484-8484-4848-8848-848484848484';
select is((select status from public.connector_installations
  where id = '10101010-1010-4010-8010-101010101010'), 'disabled',
  'provider withdrawal immediately disables its installations');

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
   'legacy-merchant', 'legacy-location', 'legacy-access', 'legacy-refresh', now() + interval '1 day', 1),
  ('83838383-8383-4838-8838-838383838383', '88888888-8888-4888-8888-888888888888',
   'current-merchant', 'current-location', 'current-access', 'current-refresh', now() + interval '1 day', 2);
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', '81818181-8181-4818-8818-818181818181', 'role', 'authenticated',
  'app_metadata', jsonb_build_object('role', 'brand_owner',
    'brand_id', '83838383-8383-4838-8838-838383838383'))::text, true);
select is((select count(*) from public.location_square_status
  where brand_id = '83838383-8383-4838-8838-838383838383'), 2::bigint,
  'owners see legacy and current Square grants');
select is((select min(oauth_scope_contract_version) from public.location_square_status), 1,
  'legacy Square grants remain visible');
select is((select max(oauth_scope_contract_version) from public.location_square_status), 2,
  'current Square grants expose their contract');
select lives_ok('select app.assert_connector_credential_lifecycle()',
  'the lifecycle release assertion passes');
select * from finish();
rollback;
