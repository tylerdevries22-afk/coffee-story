begin;
create extension if not exists pgtap with schema extensions;
set search_path = extensions, public, pg_catalog;
select plan(13);

update public.connector_registry set availability = 'available', is_active = true
where provider_key in ('slack', 'google-suite');
update public.connector_certifications certification set
  status = 'passed', certified_at = now(), valid_until = now() + interval '1 day'
from public.connector_capabilities capability
join public.connector_registry provider on provider.id = capability.provider_id
where certification.capability_id = capability.id
  and provider.provider_key = 'slack'
  and capability.capability_key = 'alerts.write'
  and certification.environment = 'sandbox';
create temp table bound_fixture (
  kind text not null,
  brand_id uuid not null,
  installation_id uuid not null,
  reference_id uuid not null,
  refresh_job_id uuid,
  refresh_lease_token uuid,
  revoke_job_id uuid
) on commit drop;

do $fixture$
declare
  v_brand uuid;
  v_installation uuid;
  v_job uuid;
  v_provider uuid;
  v_provider_key text;
  v_reference uuid;
  v_token uuid;
  v_credential jsonb;
begin
  for i in 1..9 loop
    v_provider_key := case when i <= 6 then 'slack' else 'google-suite' end;
    select id into v_provider from public.connector_registry
    where provider_key = v_provider_key;
    v_brand := gen_random_uuid();
    v_installation := gen_random_uuid();
    insert into public.brands (id, slug, name) values
      (v_brand, 'oauth-bound-' || i, 'OAuth bound ' || i);
    v_credential := jsonb_build_object(
      'access_token', 'bounded-access-' || i,
      'refresh_token', 'bounded-refresh-' || i,
      'external_account_id', 'bounded-account-' || i
    );
    v_reference := public.store_connector_secret(
      v_brand, v_provider_key, v_credential::text,
      'Bounded ' || i, array['chat:write'], now() + interval '1 hour'
    );
    update public.credential_references set
      external_account_fingerprint = app.connector_external_account_fingerprint(
        v_provider, v_credential::text
      )
    where id = v_reference;
    insert into public.connector_installations (
      id, brand_id, provider_id, credential_reference_id, status,
      enabled_capabilities, settings
    ) select v_installation, v_brand, provider.id, v_reference,
      case when i <= 3 then 'connected_degraded' else 'revoked' end,
      case when i <= 3 then array['alerts.write'] else '{}' end,
      jsonb_build_object('oauthRequestedScopes', jsonb_build_array('chat:write'))
    from public.connector_registry provider
    where provider.id = v_provider;
    if i <= 3 then
      v_token := gen_random_uuid();
      insert into app_private.connector_oauth_lifecycle_jobs (
        brand_id, installation_id, credential_reference_id, provider_id,
        operation, state, credential_generation, attempt_count,
        next_attempt_at, lease_token, lease_expires_at
      ) select v_brand, v_installation, v_reference, provider.id,
        'refresh', 'leased', 1, 50, now(), v_token, now() - interval '1 minute'
      from public.connector_registry provider
      where provider.id = v_provider
      returning id into v_job;
      insert into bound_fixture values
        ('refresh_exhaust', v_brand, v_installation, v_reference,
         v_job, v_token, null);
    elsif i <= 6 then
      update public.credential_references set revoked_at = now()
      where id = v_reference;
      v_token := gen_random_uuid();
      insert into app_private.connector_oauth_lifecycle_jobs (
        brand_id, installation_id, credential_reference_id, provider_id,
        operation, state, credential_generation, attempt_count,
        next_attempt_at, lease_token, lease_expires_at
      ) select v_brand, v_installation, v_reference, provider.id,
        'revoke', 'leased', 1, 50, now(), v_token, now() - interval '1 minute'
      from public.connector_registry provider
      where provider.id = v_provider
      returning id into v_job;
      insert into bound_fixture values
        ('revoke_exhaust', v_brand, v_installation, v_reference,
         null, null, v_job);
    else
      update public.credential_references set revoked_at = now()
      where id = v_reference;
      v_token := gen_random_uuid();
      insert into app_private.connector_oauth_lifecycle_jobs (
        brand_id, installation_id, credential_reference_id, provider_id,
        operation, state, credential_generation, attempt_count,
        next_attempt_at, lease_token, lease_expires_at, cancel_requested
      ) select v_brand, v_installation, v_reference, provider.id,
        'refresh', 'leased', 1, 1, now(), v_token,
        now() - interval '1 minute', true
      from public.connector_registry provider
      where provider.id = v_provider
      returning id into v_job;
      insert into app_private.connector_oauth_lifecycle_jobs (
        brand_id, installation_id, credential_reference_id, provider_id,
        operation, credential_generation, next_attempt_at
      ) select v_brand, v_installation, v_reference, provider.id,
        'revoke', 1, now()
      from public.connector_registry provider
      where provider.id = v_provider
      returning id into v_installation;
      insert into bound_fixture values
        ('fence', v_brand, (select installation_id from
          app_private.connector_oauth_lifecycle_jobs where id = v_job),
         v_reference, v_job, v_token, v_installation);
    end if;
  end loop;
end $fixture$;

select is((select count(*) from public.claim_connector_oauth_refreshes(now(), 1, 60)),
  1::bigint, 'refresh claim reclaims one retryable attempt-fifty lease');
select is((select count(*) from app_private.connector_oauth_lifecycle_jobs job
  join bound_fixture fixture on fixture.refresh_job_id = job.id
  where fixture.kind = 'refresh_exhaust' and job.state = 'permanent_failure'),
  0::bigint, 'attempt ceilings do not strand retryable refresh work');
select is((select count(*) from app_private.connector_oauth_lifecycle_jobs job
  join bound_fixture fixture on fixture.refresh_job_id = job.id
  where fixture.kind = 'refresh_exhaust' and job.state = 'leased'),
  3::bigint, 'refresh reclaim remains bounded without terminalizing siblings');

create temp table bounded_revoke_claim as select *
from public.claim_connector_oauth_revocations(now(), 1, 60);
select is((select count(*) from bounded_revoke_claim), 1::bigint,
  'one fenced revocation is claimed');
select is((select count(*) from app_private.connector_oauth_lifecycle_jobs job
  join bound_fixture fixture on fixture.revoke_job_id = job.id
  where fixture.kind = 'revoke_exhaust' and job.state = 'permanent_failure'),
  0::bigint, 'attempt ceilings do not strand retryable revocation work');
select is((select count(*) from app_private.connector_oauth_lifecycle_jobs job
  join bound_fixture fixture on fixture.revoke_job_id = job.id
  where fixture.kind = 'revoke_exhaust' and job.state = 'leased'),
  3::bigint, 'revocation reclaim remains bounded without terminalizing siblings');
select is((select count(*) from app_private.connector_oauth_lifecycle_jobs job
  join bound_fixture fixture on fixture.refresh_job_id = job.id
  where fixture.kind = 'fence' and job.state = 'cancelled'),
  2::bigint, 'refresh fencing is bounded to twice the claim limit');
select is((select count(*) from app_private.connector_oauth_lifecycle_jobs job
  join bound_fixture fixture on fixture.refresh_job_id = job.id
  where fixture.kind = 'fence' and job.state = 'leased'),
  1::bigint, 'unfenced refresh lease blocks its matching revoke job');
select ok(not exists (select 1 from bounded_revoke_claim claim
  join app_private.connector_oauth_lifecycle_jobs refresh
    on refresh.credential_reference_id = claim.credential_reference_id
   and refresh.operation = 'refresh' and refresh.state = 'leased'),
  'a revoke claim never crosses a live refresh lease');

create temp table fenced_worker as select fixture.*
from bound_fixture fixture join app_private.connector_oauth_lifecycle_jobs job
  on job.id = fixture.refresh_job_id
where fixture.kind = 'fence' and job.state = 'cancelled' limit 1;
select is((select public.complete_connector_oauth_refresh(
  refresh_job_id, refresh_lease_token,
  '{"access_token":"stale-access-token","refresh_token":"stale-refresh-token","external_account_id":"stale-account"}',
  now() + interval '1 hour', now()) from fenced_worker), false,
  'fenced refresh completion cannot rotate the old generation');
select is((select public.fail_connector_oauth_refresh(
  refresh_job_id, refresh_lease_token, 'provider_timeout', true, now())
  from fenced_worker), false, 'fenced refresh failure cannot alter the queue');
select is((select credential_generation from public.credential_references reference
  join fenced_worker fixture on fixture.reference_id = reference.id), 1::bigint,
  'fenced worker leaves the credential generation unchanged');
select is((select state from app_private.connector_oauth_lifecycle_jobs job
  join bound_fixture fixture on fixture.revoke_job_id = job.id
  where fixture.kind = 'fence' and fixture.refresh_job_id = (
    select refresh_job_id from bound_fixture fence
    join app_private.connector_oauth_lifecycle_jobs refresh
      on refresh.id = fence.refresh_job_id
    where fence.kind = 'fence' and refresh.state = 'leased' limit 1)),
  'pending', 'unfenced matching revoke remains pending');

select * from finish();
rollback;
