-- Split out of 20260908228000 so the lifecycle file can parse.

create function public.quarantine_connector_oauth_rotation_result(
  p_job_id uuid,
  p_lease_token uuid,
  p_credential jsonb,
  p_expires_at timestamptz,
  p_reason text,
  p_now timestamptz
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_external_account_id text;
  v_fingerprint text;
  v_installation_id uuid;
  v_job app_private.connector_oauth_lifecycle_jobs%rowtype;
  v_namespace text;
  v_old_credential jsonb;
  v_provider_key text;
  v_provider_id uuid;
  v_reference public.credential_references%rowtype;
  v_stored_credential jsonb;
begin
  if p_job_id is null or p_lease_token is null or p_now is null
    or p_reason is null or p_reason !~ '^[a-z][a-z0-9_]{0,63}$'
    or jsonb_typeof(p_credential) is distinct from 'object'
    or pg_column_size(p_credential) > 24576
    or jsonb_typeof(p_credential->'access_token') is distinct from 'string'
    or octet_length(p_credential->>'access_token') not between 8 and 16384
    or (p_credential ? 'refresh_token' and (
      jsonb_typeof(p_credential->'refresh_token') is distinct from 'string'
      or octet_length(p_credential->>'refresh_token') not between 8 and 16384
    )) or (p_credential ? 'external_account_id' and (
      jsonb_typeof(p_credential->'external_account_id') is distinct from 'string'
      or octet_length(p_credential->>'external_account_id') not between 1 and 512
    )) or (p_expires_at is not null and p_expires_at <= p_now) then
    raise exception using errcode = '22023', message = 'connector_oauth_quarantine_invalid';
  end if;
  select job.installation_id, job.provider_id into v_installation_id, v_provider_id
  from app_private.connector_oauth_lifecycle_jobs job where job.id = p_job_id;
  if not found then return false; end if;
  select provider.oauth_grant_namespace, provider.provider_key
  into v_namespace, v_provider_key
  from public.connector_registry provider
  where provider.id = v_provider_id and provider.oauth_lifecycle_managed
    and (provider.oauth_refresh_managed
      or provider.provider_key = 'meta-business-suite') for share;
  if not found then return false; end if;
  if p_expires_at is not null and p_expires_at > p_now +
      case when v_provider_key = 'meta-business-suite'
        then interval '90 days' else interval '30 days' end then
    raise exception using errcode = '22023', message = 'connector_oauth_quarantine_invalid';
  end if;
  perform 1 from app_private.connector_oauth_grant_namespaces grant_namespace
  where grant_namespace.namespace = v_namespace for update;
  perform 1 from public.connector_installations installation
  where installation.id = v_installation_id for update;
  if not found then return false; end if;
  select job.* into v_job from app_private.connector_oauth_lifecycle_jobs job
  where job.id = p_job_id for update;
  v_fingerprint := pg_catalog.encode(public.digest(jsonb_build_object(
    'credential', p_credential - 'granted_scopes',
    'expiresAt', to_jsonb(p_expires_at), 'reason', p_reason
  )::text, 'sha256'), 'hex');
  if v_job.last_finished_lease_token = p_lease_token then
    return v_job.last_finished_outcome = 'compensated'
      and v_job.last_finished_fingerprint = v_fingerprint;
  end if;
  if v_job.operation not in ('identify', 'refresh', 'revoke')
    or v_job.state <> 'leased'
    or v_job.lease_token <> p_lease_token
    or v_job.lease_rotation_started_at is null then return false; end if;
  if v_job.operation = 'refresh' then
    perform 1 from app_private.connector_oauth_lifecycle_jobs revoke_job
    where revoke_job.credential_reference_id = v_job.credential_reference_id
      and revoke_job.operation = 'revoke' for update;
    if exists (select 1 from app_private.connector_oauth_lifecycle_jobs revoke_job
      where revoke_job.credential_reference_id = v_job.credential_reference_id
        and revoke_job.operation = 'revoke' and revoke_job.state = 'leased') then
      return false;
    end if;
  end if;
  select reference.* into v_reference from public.credential_references reference
  where reference.id = v_job.credential_reference_id
    and reference.brand_id = v_job.brand_id
    and reference.credential_generation = v_job.credential_generation for update;
  if not found then return false; end if;
  select app.try_connector_credential_json(secret.decrypted_secret)
  into v_old_credential from vault.decrypted_secrets secret
  where secret.id = v_reference.vault_secret_id;
  if (v_job.operation = 'identify'
      and app.connector_identity_credential_valid(v_old_credential::text) is not true)
    or (v_job.operation <> 'identify' and app.connector_job_credential_valid(
      v_job.provider_id, v_job.operation, v_old_credential::text,
      v_reference.external_account_fingerprint
    ) is not true) then return false; end if;
  if jsonb_typeof(v_old_credential->'external_account_id') = 'string' then
    v_external_account_id := v_old_credential->>'external_account_id';
  end if;
  v_stored_credential := p_credential - 'granted_scopes' - 'external_account_id';
  if v_external_account_id is not null then
    v_stored_credential := jsonb_set(
      v_stored_credential, '{external_account_id}',
      to_jsonb(v_external_account_id), true
    );
  end if;
  if pg_column_size(v_stored_credential) > 24576 then
    raise exception using errcode = '22023', message = 'connector_oauth_quarantine_invalid';
  end if;
  perform vault.update_secret(
    v_reference.vault_secret_id, v_stored_credential::text, null::text, null::text
  );
  update public.credential_references reference set
    expires_at = p_expires_at, revoked_at = coalesce(reference.revoked_at, p_now),
    last_rotated_at = p_now,
    credential_generation = reference.credential_generation + 1, updated_at = p_now
  where reference.id = v_reference.id
    and reference.credential_generation = v_job.credential_generation;
  if not found then return false; end if;
  if v_job.operation = 'refresh' then
    insert into app_private.connector_oauth_lifecycle_jobs (
      brand_id, installation_id, credential_reference_id, provider_id,
      operation, credential_generation, next_attempt_at
    ) values (v_job.brand_id, v_job.installation_id, v_job.credential_reference_id,
      v_job.provider_id, 'revoke', v_job.credential_generation + 1, p_now)
    on conflict (credential_reference_id, operation) do update set
      state = 'pending', credential_generation = excluded.credential_generation,
      attempt_count = 0, next_attempt_at = p_now,
      lease_token = null, lease_expires_at = null,
      lease_rotation_started_at = null, lease_rotation_fingerprint = null,
      rotation_replay_deadline = null,
      last_finished_lease_token = null, last_finished_outcome = null,
      last_finished_fingerprint = null, cancel_requested = false,
      last_error_code = null, completed_at = null, updated_at = p_now;
  end if;
  update app_private.connector_oauth_lifecycle_jobs job set
    state = case when job.operation = 'refresh'
      then 'permanent_failure' else 'pending' end,
    credential_generation = job.credential_generation + 1,
    attempt_count = case when job.operation = 'refresh'
      then job.attempt_count else 0 end,
    next_attempt_at = case when job.operation = 'refresh'
      then job.next_attempt_at else p_now end,
    lease_token = null, lease_expires_at = null,
    lease_rotation_started_at = null, lease_rotation_fingerprint = null,
    rotation_replay_deadline = null,
    last_finished_lease_token = p_lease_token,
    last_finished_outcome = 'compensated',
    last_finished_fingerprint = v_fingerprint,
    cancel_requested = false,
    last_error_code = p_reason,
    completed_at = case when job.operation = 'refresh' then p_now else null end,
    updated_at = p_now
  where job.id = v_job.id;
  update public.connector_installations installation set
    status = 'reauthorization_required', enabled_capabilities = '{}', updated_at = p_now
  where installation.id = v_job.installation_id
    and installation.brand_id = v_job.brand_id
    and installation.credential_reference_id = v_job.credential_reference_id
    and v_job.operation = 'refresh';
  insert into public.connector_audit_events (
    brand_id, installation_id, action, outcome, correlation_id, source, detail
  ) values (v_job.brand_id, v_job.installation_id,
    'oauth.rotation_quarantined', 'failure', p_lease_token, 'cron',
    jsonb_build_object('operation', v_job.operation, 'reason', p_reason,
      'credentialGeneration', v_job.credential_generation + 1,
      'revocationQueued', v_job.operation = 'refresh'));
  return true;
end $$;


revoke all on function public.quarantine_connector_oauth_rotation_result(uuid, uuid, jsonb, timestamptz, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.quarantine_connector_oauth_rotation_result(uuid, uuid, jsonb, timestamptz, text, timestamptz)
  to service_role;

