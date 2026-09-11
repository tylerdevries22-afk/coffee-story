-- plpgsql_check: unused locals fail `supabase db lint --fail-on warning`.
-- Keep the CTE/queue side effects; stop assigning their results to unread vars.

CREATE OR REPLACE FUNCTION public.complete_connector_oauth_connection(p_brand_id uuid, p_installation_id uuid, p_provider_key text, p_actor_user_id uuid, p_completion_key uuid, p_credential jsonb, p_account_label text, p_granted_scopes text[], p_expires_at timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_contract_version text;
  v_completion_fingerprint text;
  v_enabled_capabilities text[];
  v_external_account_fingerprint text;
  v_granted_scopes text[];
  v_grant_namespace text;
  v_previous_reference uuid;
  v_previous_reference_row public.credential_references%rowtype;
  v_provider_available boolean;
  v_provider_id uuid;
  v_refresh_managed boolean;
  v_reference_id uuid;
  v_rejection_reason text;
  v_revocation_scope text;
  v_state app_private.connector_oauth_states%rowtype;
begin
  if p_brand_id is null or p_installation_id is null
    or p_provider_key is null or p_provider_key !~ '^[a-z][a-z0-9_-]{0,62}$'
    or p_actor_user_id is null or p_completion_key is null
    or jsonb_typeof(p_credential) is distinct from 'object'
    or pg_column_size(p_credential) > 24576
    or jsonb_typeof(p_credential->'access_token') is distinct from 'string'
    or octet_length(p_credential->>'access_token') not between 8 and 16384
    or p_account_label is null
    or length(btrim(p_account_label)) not between 1 and 160
    or p_granted_scopes is null
    or cardinality(p_granted_scopes) not between 0 and 32
    or exists (
      select 1 from unnest(p_granted_scopes) granted(scope)
      where granted.scope is null or length(granted.scope) not between 1 and 512
    ) then
    raise exception using errcode = '22023', message = 'connector_oauth_payload_invalid';
  end if;

  select coalesce(array_agg(distinct granted.scope order by granted.scope), '{}')
  into v_granted_scopes from unnest(p_granted_scopes) granted(scope);
  v_completion_fingerprint := pg_catalog.encode(public.digest(
    jsonb_build_object(
      'credential', p_credential,
      'accountLabel', btrim(p_account_label),
      'grantedScopes', to_jsonb(v_granted_scopes),
      'expiresAt', to_jsonb(p_expires_at)
    )::text, 'sha256'
  ), 'hex');

  select provider.id, provider.adapter_contract_version,
    provider.is_active
      and provider.availability in ('available', 'provider_approval_required'),
    provider.oauth_refresh_managed, provider.oauth_revocation_scope,
    provider.oauth_grant_namespace
  into v_provider_id, v_contract_version, v_provider_available,
    v_refresh_managed, v_revocation_scope, v_grant_namespace
  from public.connector_registry provider
  where provider.provider_key = p_provider_key
    and provider.oauth_lifecycle_managed
  for update;
  if v_provider_id is null then
    raise exception using errcode = '22023', message = 'connector_provider_unavailable';
  end if;
  perform 1 from app_private.connector_oauth_grant_namespaces grant_namespace
  where grant_namespace.namespace = v_grant_namespace for update;
  v_external_account_fingerprint := app.connector_external_account_fingerprint(
    v_provider_id, p_credential::text
  );

  perform 1 from public.connector_capabilities capability
  where capability.provider_id = v_provider_id for share;
  perform 1 from public.connector_certifications certification
  join public.connector_capabilities capability
    on capability.id = certification.capability_id
  where capability.provider_id = v_provider_id for share of certification;

  select installation.credential_reference_id into v_previous_reference
  from public.connector_installations installation
  where installation.id = p_installation_id
    and installation.brand_id = p_brand_id
    and installation.provider_id = v_provider_id
    and installation.environment = 'production'
  for update;
  if not found then
    raise exception using errcode = '22023', message = 'connector_installation_unknown';
  end if;
  if v_previous_reference is not null then
    select reference.* into v_previous_reference_row
    from public.credential_references reference
    where reference.id = v_previous_reference
      and reference.brand_id = p_brand_id
    for update;
    if not found then
      raise exception using errcode = '55000',
        message = 'connector_oauth_existing_credential_invalid';
    end if;
  end if;

  select state.* into v_state
  from app_private.connector_oauth_states state
  where state.installation_id = p_installation_id
    and state.brand_id = p_brand_id
    and state.provider_id = v_provider_id
    and state.requested_by = p_actor_user_id
    and state.consume_key = p_completion_key
  for update;
  if not found then
    raise exception using errcode = '22023', message = 'connector_oauth_state_incomplete';
  end if;

  if v_state.completion_key = p_completion_key
    and v_state.completed_reference_id is not null then
    if v_state.completion_fingerprint = v_completion_fingerprint then
      return case when v_state.completion_outcome = 'connected'
        then v_state.completed_reference_id else null end;
    end if;
    if v_previous_reference_row.external_account_fingerprint
      = v_external_account_fingerprint then
      raise exception using errcode = '22023',
        message = 'connector_oauth_completion_conflict_shared_grant';
    end if;
    raise exception using errcode = '22023',
      message = 'connector_oauth_completion_conflict_safe_revoke';
  end if;
  if v_state.completion_key is not null then
    raise exception using errcode = '22023', message = 'connector_oauth_completion_conflict';
  end if;
  if v_state.exchange_started_at is null then
    v_rejection_reason := 'exchange_not_started';
  end if;
  if v_state.superseded_at is not null then
    v_rejection_reason := 'authorization_superseded';
  end if;
  if v_rejection_reason is null and v_previous_reference is not null then
    perform 1 from app_private.connector_oauth_lifecycle_jobs job
    where job.credential_reference_id = v_previous_reference
    order by job.operation for update;
    if exists (
      select 1 from app_private.connector_oauth_lifecycle_jobs job
      where job.credential_reference_id = v_previous_reference
        and job.operation in ('refresh', 'revoke') and job.state = 'leased'
    ) then
      v_rejection_reason := 'credential_operation_in_progress';
    end if;
    if v_previous_reference_row.external_account_fingerprint is null then
      v_rejection_reason := 'existing_grant_unidentified';
    end if;
    if v_revocation_scope = 'grant' then
      v_rejection_reason := 'prior_grant_requires_revocation';
    end if;
  end if;

  if v_rejection_reason is null and v_revocation_scope = 'grant'
    and v_external_account_fingerprint is not null
    and exists (
      select 1
      from app_private.connector_oauth_lifecycle_jobs revoke_job
      join public.credential_references retiring_reference
        on retiring_reference.id = revoke_job.credential_reference_id
       and retiring_reference.brand_id = revoke_job.brand_id
      join public.connector_registry retiring_provider
        on retiring_provider.id = revoke_job.provider_id
      where revoke_job.operation = 'revoke'
        and (revoke_job.state in ('pending', 'leased', 'permanent_failure')
          or (revoke_job.state = 'succeeded'
            and revoke_job.last_error_code is distinct from 'shared_grant_retained'
            and revoke_job.completed_at >= v_state.consumed_at))
        and retiring_provider.oauth_lifecycle_managed
        and retiring_provider.oauth_revocation_scope = 'grant'
        and retiring_provider.oauth_grant_namespace = v_grant_namespace
        and retiring_reference.external_account_fingerprint
          = v_external_account_fingerprint
    ) then
    v_rejection_reason := 'grant_revocation_in_progress';
  end if;

  if v_rejection_reason is null and not exists (
    select 1 from public.brand_users member
    where member.user_id = p_actor_user_id
      and (member.role = 'platform_admin'
        or (member.brand_id = p_brand_id and member.role = 'brand_owner'))
  ) then
    v_rejection_reason := 'actor_forbidden';
  end if;
  if v_rejection_reason is null and not v_provider_available then
    v_rejection_reason := 'provider_unavailable';
  end if;
  if v_rejection_reason is null and (v_state.consumed_at is null
    or v_state.expires_at <= now()
    or (p_expires_at is not null and p_expires_at <= now())) then
    v_rejection_reason := 'state_or_credential_expired';
  end if;
  if v_rejection_reason is null
    and v_state.provider_contract_version is distinct from v_contract_version then
    v_rejection_reason := 'provider_contract_changed';
  end if;
  if v_rejection_reason is null
    and not v_state.requested_scopes <@ v_granted_scopes then
    v_rejection_reason := 'scope_grant_incomplete';
  end if;
  if v_rejection_reason is null and v_refresh_managed and (
    jsonb_typeof(p_credential->'refresh_token') is distinct from 'string'
    or octet_length(p_credential->>'refresh_token') not between 8 and 16384
    or p_expires_at is null or p_expires_at <= now()
    or p_expires_at > now() + interval '30 days'
  ) then
    v_rejection_reason := 'refresh_contract_invalid';
  end if;

  select coalesce(array_agg(
    capability.capability_key order by capability.capability_key
  ), '{}') into v_enabled_capabilities
  from public.connector_capabilities capability
  where capability.provider_id = v_provider_id
    and capability.is_active
    and (cardinality(capability.oauth_scopes) = 0
      or (capability.oauth_scopes <@ v_state.requested_scopes
        and capability.oauth_scopes <@ v_granted_scopes))
    and exists (
      select 1 from public.connector_certifications certification
      where certification.capability_id = capability.id
        and certification.environment = 'sandbox'
        and certification.status = 'passed'
        and certification.contract_version = v_contract_version
        and certification.certified_at is not null
        and (certification.valid_until is null or certification.valid_until > now())
    );
  if v_rejection_reason is null and cardinality(v_enabled_capabilities) = 0 then
    v_rejection_reason := 'capability_unavailable';
  end if;
  if v_rejection_reason is null and v_revocation_scope = 'grant'
    and exists (
      select 1
      from public.connector_installations other_installation
      join public.credential_references other_reference
        on other_reference.id = other_installation.credential_reference_id
       and other_reference.brand_id = other_installation.brand_id
      join public.connector_registry other_provider
        on other_provider.id = other_reference.provider_id
      where other_installation.id <> p_installation_id
        and other_reference.revoked_at is null
        and other_reference.external_account_fingerprint = v_external_account_fingerprint
        and other_provider.oauth_grant_namespace = v_grant_namespace
    ) then
    v_rejection_reason := 'shared_grant_already_connected';
  end if;
  if v_rejection_reason is null and v_external_account_fingerprint is null then
    v_rejection_reason := 'external_account_unresolved';
  end if;
  if v_rejection_reason is not null then
    perform app.queue_connector_oauth_compensation_internal(
      p_brand_id, p_installation_id, v_provider_id, p_actor_user_id,
      p_completion_key, p_completion_key, p_credential, p_account_label,
      v_granted_scopes, p_expires_at, v_rejection_reason,
      v_completion_fingerprint, '{}'::jsonb
    );
    return null;
  end if;

  v_reference_id := public.store_connector_secret(
    p_brand_id, p_provider_key, p_credential::text, p_account_label,
    v_granted_scopes, p_expires_at
  );
  update public.credential_references reference set
    external_account_fingerprint = v_external_account_fingerprint,
    updated_at = now()
  where reference.id = v_reference_id and reference.brand_id = p_brand_id;
  update public.connector_installations installation set
    credential_reference_id = v_reference_id,
    status = case when v_refresh_managed then 'connected_healthy'
      when p_expires_at is not null and p_expires_at <= now() + interval '7 days'
      then 'connected_degraded' else 'connected_healthy' end,
    enabled_capabilities = v_enabled_capabilities,
    external_account_label = p_account_label,
    settings = installation.settings || jsonb_build_object(
      'oauthRequestedScopes', to_jsonb(v_state.requested_scopes)
    ),
    connected_by = p_actor_user_id,
    connected_at = now(),
    disabled_at = null,
    updated_at = now()
  where installation.id = p_installation_id
    and installation.brand_id = p_brand_id;

  update app_private.connector_oauth_states state set
    completion_key = p_completion_key,
    completed_reference_id = v_reference_id,
    completion_fingerprint = v_completion_fingerprint,
    completion_outcome = 'connected',
    processing_lease_token = null,
    processing_lease_expires_at = null,
    exchange_attempt_key = null,
    exchange_started_at = null
  where state.id = v_state.id;

  if v_refresh_managed then
    insert into app_private.connector_oauth_lifecycle_jobs (
      brand_id, installation_id, credential_reference_id, provider_id,
      operation, credential_generation, next_attempt_at
    ) values (
      p_brand_id, p_installation_id, v_reference_id, v_provider_id,
      'refresh', 1,
      greatest(now() + interval '1 minute', p_expires_at - interval '10 minutes')
    );
  end if;

  if v_previous_reference is not null
    and v_previous_reference <> v_reference_id then
    update app_private.connector_oauth_lifecycle_jobs job set
      state = case when job.state = 'leased' then 'leased' else 'cancelled' end,
      cancel_requested = true,
      lease_token = case when job.state = 'leased' then job.lease_token else null end,
      lease_expires_at = case
        when job.state = 'leased' then job.lease_expires_at else null end,
      completed_at = case when job.state = 'leased' then null else now() end,
      updated_at = now()
    where job.credential_reference_id = v_previous_reference
      and job.operation = 'refresh'
      and job.state not in ('succeeded', 'cancelled');
    update public.credential_references reference set
      revoked_at = coalesce(reference.revoked_at, now()), updated_at = now()
    where reference.id = v_previous_reference
      and reference.brand_id = p_brand_id;
    insert into app_private.connector_oauth_lifecycle_jobs (
        brand_id, installation_id, credential_reference_id, provider_id,
        operation, credential_generation, next_attempt_at
      ) select
        reference.brand_id, p_installation_id, reference.id, reference.provider_id,
        'revoke', reference.credential_generation, now()
      from public.credential_references reference
      where reference.id = v_previous_reference
        and reference.brand_id = p_brand_id
      on conflict (credential_reference_id, operation) do update set
        state = case when connector_oauth_lifecycle_jobs.state = 'succeeded'
          then 'succeeded' else 'pending' end,
        attempt_count = case when connector_oauth_lifecycle_jobs.state = 'succeeded'
          then connector_oauth_lifecycle_jobs.attempt_count else 0 end,
        next_attempt_at = case when connector_oauth_lifecycle_jobs.state = 'succeeded'
          then connector_oauth_lifecycle_jobs.next_attempt_at else now() end,
        lease_token = null, lease_expires_at = null,
        last_finished_lease_token = case
          when connector_oauth_lifecycle_jobs.state = 'succeeded'
            then connector_oauth_lifecycle_jobs.last_finished_lease_token else null end,
        last_finished_outcome = case
          when connector_oauth_lifecycle_jobs.state = 'succeeded'
            then connector_oauth_lifecycle_jobs.last_finished_outcome else null end,
        last_finished_fingerprint = case
          when connector_oauth_lifecycle_jobs.state = 'succeeded'
            then connector_oauth_lifecycle_jobs.last_finished_fingerprint else null end,
        last_error_code = null,
        completed_at = case when connector_oauth_lifecycle_jobs.state = 'succeeded'
          then connector_oauth_lifecycle_jobs.completed_at else null end,
        updated_at = now();
  end if;

  insert into public.connector_audit_events (
    brand_id, installation_id, actor_user_id, action, outcome,
    correlation_id, source, detail
  ) values (
    p_brand_id, p_installation_id, p_actor_user_id, 'oauth.connected',
    'success', p_completion_key, 'hq', jsonb_build_object(
      'provider', p_provider_key,
      'requestedScopeCount', cardinality(v_state.requested_scopes),
      'grantedScopeCount', cardinality(v_granted_scopes)
    )
  );
  return v_reference_id;
end $function$;

CREATE OR REPLACE FUNCTION public.claim_connector_oauth_revocations(p_now timestamp with time zone, p_limit integer, p_lease_seconds integer)
 RETURNS TABLE(job_id uuid, brand_id uuid, installation_id uuid, credential_reference_id uuid, provider_key text, credential_generation bigint, lease_token uuid, credential jsonb, account_label text, granted_scopes text[])
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_local_token uuid;
  v_maintenance_count integer;
  v_shared record;
begin
  if p_now is null or p_limit is null or p_limit not between 1 and 100
    or p_lease_seconds is null or p_lease_seconds not between 15 and 600 then
    raise exception using errcode = '22023', message = 'connector_oauth_claim_invalid';
  end if;

  -- Namespace rows serialize authorization completion with grant-wide claims.
  perform 1
  from app_private.connector_oauth_grant_namespaces grant_namespace
  order by grant_namespace.namespace
  for update;

  -- An expired lease from a rotating-token adapter is ambiguous: the provider
  -- may have issued a one-use replacement that never reached this database.
  with ambiguous_candidates as (
    select job.id, job.lease_token as expired_lease_token
    from app_private.connector_oauth_lifecycle_jobs job
    join public.connector_registry provider on provider.id = job.provider_id
    where job.operation = 'revoke' and job.state = 'leased'
      and job.lease_expires_at <= p_now
      and job.lease_rotation_started_at is not null
      and job.lease_rotation_fingerprint is null
      and provider.provider_key in ('slack', 'tiktok')
    order by job.lease_expires_at, job.id
    for update of job skip locked
    limit p_limit
  ), ambiguous as (
    update app_private.connector_oauth_lifecycle_jobs job set
      state = 'permanent_failure', lease_token = null, lease_expires_at = null,
      last_finished_lease_token = ambiguous_candidate.expired_lease_token,
      last_finished_outcome = 'failed',
      last_finished_fingerprint = pg_catalog.encode(public.digest(
        jsonb_build_object(
          'errorCode', 'rotation_ambiguous', 'retryable', false
        )::text, 'sha256'
      ), 'hex'),
      last_error_code = 'rotation_ambiguous', completed_at = p_now,
      updated_at = p_now
    from ambiguous_candidates ambiguous_candidate
    where job.id = ambiguous_candidate.id
    returning job.*, ambiguous_candidate.expired_lease_token
  )
  insert into public.connector_audit_events (
    brand_id, installation_id, action, outcome, correlation_id, source, detail
  ) select ambiguous.brand_id, ambiguous.installation_id,
    'oauth.revocation_failed', 'failure', ambiguous.expired_lease_token,
    'cron', jsonb_build_object(
      'errorCode', 'rotation_ambiguous', 'retryable', false
    )
  from ambiguous;

  -- Disconnect can race an in-flight refresh. Reusable-token providers are
  -- fenced after lease expiry; rotating-token providers retain manual evidence.
  with ambiguous_refresh_candidates as (
    select refresh_job.id, refresh_job.credential_reference_id,
      refresh_job.lease_token as expired_lease_token
    from app_private.connector_oauth_lifecycle_jobs refresh_job
    join public.connector_registry provider on provider.id = refresh_job.provider_id
    where refresh_job.operation = 'refresh' and refresh_job.cancel_requested
      and ((refresh_job.state = 'leased'
          and refresh_job.lease_expires_at <= p_now
          and refresh_job.lease_rotation_started_at is not null
          and refresh_job.lease_rotation_fingerprint is null
          and provider.provider_key in ('slack', 'tiktok'))
        or (provider.provider_key = 'quickbooks-online'
          and refresh_job.rotation_replay_deadline <= p_now
          and (refresh_job.state = 'pending' or (
            refresh_job.state = 'leased'
            and refresh_job.lease_expires_at <= p_now))))
    order by refresh_job.lease_expires_at, refresh_job.id
    for update of refresh_job skip locked
    limit p_limit
  ), ambiguous_refreshes as (
    update app_private.connector_oauth_lifecycle_jobs refresh_job set
      state = 'permanent_failure', lease_token = null, lease_expires_at = null,
      last_finished_lease_token = candidate.expired_lease_token,
      last_finished_outcome = 'failed',
      last_finished_fingerprint = pg_catalog.encode(public.digest(
        jsonb_build_object(
          'errorCode', 'rotation_ambiguous', 'retryable', false
        )::text, 'sha256'
      ), 'hex'),
      last_error_code = 'rotation_ambiguous', completed_at = p_now,
      updated_at = p_now
    from ambiguous_refresh_candidates candidate
    where refresh_job.id = candidate.id
    returning refresh_job.*, candidate.expired_lease_token
  ), blocked_revocations as (
    update app_private.connector_oauth_lifecycle_jobs revoke_job set
      state = 'permanent_failure', lease_token = null, lease_expires_at = null,
      last_error_code = 'rotation_ambiguous', completed_at = p_now,
      updated_at = p_now
    from ambiguous_refreshes refresh_job
    where revoke_job.credential_reference_id = refresh_job.credential_reference_id
      and revoke_job.operation = 'revoke'
      and revoke_job.state not in ('leased', 'succeeded')
    returning revoke_job.id
  )
  insert into public.connector_audit_events (
    brand_id, installation_id, action, outcome, correlation_id, source, detail
  ) select refresh_job.brand_id, refresh_job.installation_id,
    'oauth.refresh_failed', 'failure', refresh_job.expired_lease_token,
    'cron', jsonb_build_object(
      'errorCode', 'rotation_ambiguous', 'retryable', false,
      'revocationBlocked', true
    )
  from ambiguous_refreshes refresh_job;

  with fence_candidates as (
    select refresh_job.id
    from app_private.connector_oauth_lifecycle_jobs refresh_job
    join public.connector_registry provider on provider.id = refresh_job.provider_id
    where refresh_job.operation = 'refresh'
      and refresh_job.state = 'leased' and refresh_job.cancel_requested
      and refresh_job.lease_expires_at <= p_now
      and (provider.provider_key not in ('slack', 'tiktok', 'quickbooks-online')
        or refresh_job.lease_rotation_started_at is null
        or refresh_job.lease_rotation_fingerprint is not null)
    order by refresh_job.lease_expires_at, refresh_job.id
    for update of refresh_job skip locked
    limit least(p_limit * 2, 200)
  ), fenced_refreshes as (
    update app_private.connector_oauth_lifecycle_jobs refresh_job set
      state = 'cancelled', lease_token = null, lease_expires_at = null,
      last_error_code = 'lease_cancelled', completed_at = p_now,
      updated_at = p_now
    from fence_candidates candidate
    where refresh_job.id = candidate.id
    returning refresh_job.id
  )
  select count(*) into v_maintenance_count from fenced_refreshes;
  perform v_maintenance_count;

  -- A grant-wide credential is retired locally when another live installation
  -- owns the same provider grant. Calling the provider would revoke that owner.
  for v_shared in
    select job.id, job.brand_id, job.installation_id,
      job.credential_reference_id, job.credential_generation
    from app_private.connector_oauth_lifecycle_jobs job
    join public.credential_references reference
      on reference.id = job.credential_reference_id
     and reference.brand_id = job.brand_id
     and reference.credential_generation = job.credential_generation
    join public.connector_registry provider on provider.id = job.provider_id
    join vault.decrypted_secrets secret on secret.id = reference.vault_secret_id
    where job.operation = 'revoke' and job.state = 'pending'
      and job.next_attempt_at <= p_now
      and provider.oauth_lifecycle_managed
      and provider.oauth_revocation_scope = 'grant'
      and app.connector_job_credential_valid(
        job.provider_id, 'revoke', secret.decrypted_secret,
        reference.external_account_fingerprint
      )
      and not exists (
        select 1 from app_private.connector_oauth_lifecycle_jobs refresh_job
        where refresh_job.credential_reference_id = job.credential_reference_id
          and refresh_job.operation = 'refresh' and refresh_job.state = 'leased'
      )
      and exists (
        select 1
        from public.connector_installations live_installation
        join public.credential_references live_reference
          on live_reference.id = live_installation.credential_reference_id
         and live_reference.brand_id = live_installation.brand_id
        join public.connector_registry live_provider
          on live_provider.id = live_reference.provider_id
        where live_reference.id <> reference.id
          and live_reference.revoked_at is null
          and live_reference.external_account_fingerprint
            = reference.external_account_fingerprint
          and live_provider.oauth_grant_namespace = provider.oauth_grant_namespace
      )
    order by job.next_attempt_at, job.created_at, job.id
    for update of job skip locked
    limit p_limit
  loop
    v_local_token := gen_random_uuid();
    update app_private.connector_oauth_lifecycle_jobs job set
      state = 'succeeded', lease_token = null, lease_expires_at = null,
      last_finished_lease_token = v_local_token,
      last_finished_outcome = 'completed', last_finished_fingerprint = null,
      last_error_code = 'shared_grant_retained', completed_at = p_now,
      updated_at = p_now
    where job.id = v_shared.id;
    perform public.revoke_connector_secret(
      v_shared.credential_reference_id, v_shared.brand_id
    );
    update public.connector_installations installation set
      credential_reference_id = null, updated_at = p_now
    where installation.id = v_shared.installation_id
      and installation.brand_id = v_shared.brand_id
      and installation.credential_reference_id = v_shared.credential_reference_id
      and installation.status in ('revoked', 'disabled');
    insert into public.connector_audit_events (
      brand_id, installation_id, action, outcome, correlation_id, source, detail
    ) values (
      v_shared.brand_id, v_shared.installation_id,
      'oauth.revocation_completed', 'success', v_local_token, 'cron',
      jsonb_build_object(
        'credentialGeneration', v_shared.credential_generation,
        'providerCallSkipped', true, 'reason', 'shared_grant_retained'
      )
    );
  end loop;

  with malformed_candidates as (
    select job.id
    from app_private.connector_oauth_lifecycle_jobs job
    join public.credential_references reference
      on reference.id = job.credential_reference_id
     and reference.brand_id = job.brand_id
     and reference.credential_generation = job.credential_generation
    join public.connector_registry provider on provider.id = job.provider_id
    left join vault.decrypted_secrets secret on secret.id = reference.vault_secret_id
    where job.operation = 'revoke'
      and job.next_attempt_at <= p_now
      and (job.state = 'pending'
        or (job.state = 'leased' and job.lease_expires_at <= p_now))
      and app.connector_job_credential_valid(
        job.provider_id, 'revoke', secret.decrypted_secret,
        reference.external_account_fingerprint
      ) is not true
    order by job.next_attempt_at, job.created_at, job.id
    for update of job skip locked
    limit p_limit
  ), quarantined as (
    update app_private.connector_oauth_lifecycle_jobs job set
      state = 'permanent_failure', lease_token = null, lease_expires_at = null,
      last_error_code = 'credential_malformed', completed_at = p_now,
      updated_at = p_now
    from malformed_candidates candidate where job.id = candidate.id
    returning job.*
  )
  insert into public.connector_audit_events (
    brand_id, installation_id, action, outcome, correlation_id, source, detail
  ) select quarantined.brand_id, quarantined.installation_id,
    'oauth.revocation_failed', 'failure', gen_random_uuid(), 'cron',
    jsonb_build_object('errorCode', 'credential_malformed', 'retryable', false)
  from quarantined;

  return query
  with eligible as (
    select job.id, provider.provider_key, job.next_attempt_at, job.created_at,
      row_number() over (
        partition by case when provider.oauth_revocation_scope = 'grant'
          then provider.oauth_grant_namespace || ':'
            || reference.external_account_fingerprint
          else job.id::text end
        order by job.next_attempt_at, job.created_at, job.id
      ) as grant_rank
    from app_private.connector_oauth_lifecycle_jobs job
    join public.credential_references reference
      on reference.id = job.credential_reference_id
     and reference.brand_id = job.brand_id
     and reference.credential_generation = job.credential_generation
    join public.connector_registry provider on provider.id = job.provider_id
    join vault.decrypted_secrets secret on secret.id = reference.vault_secret_id
    where job.operation = 'revoke'
      and job.next_attempt_at <= p_now
      and (job.state = 'pending'
        or (job.state = 'leased' and job.lease_expires_at <= p_now))
      and provider.oauth_lifecycle_managed
      and app.connector_job_credential_valid(
        job.provider_id, 'revoke', secret.decrypted_secret,
        reference.external_account_fingerprint
      ) is true
      and not exists (
        select 1 from app_private.connector_oauth_lifecycle_jobs refresh_job
        where refresh_job.credential_reference_id = job.credential_reference_id
          and refresh_job.operation = 'refresh' and refresh_job.state = 'leased'
      )
      and (provider.oauth_revocation_scope = 'credential' or (
        not exists (
          select 1
          from public.connector_installations live_installation
          join public.credential_references live_reference
            on live_reference.id = live_installation.credential_reference_id
           and live_reference.brand_id = live_installation.brand_id
          join public.connector_registry live_provider
            on live_provider.id = live_reference.provider_id
          where live_reference.revoked_at is null
            and live_reference.external_account_fingerprint
              = reference.external_account_fingerprint
            and live_provider.oauth_grant_namespace
              = provider.oauth_grant_namespace
        )
        and not exists (
          select 1
          from app_private.connector_oauth_lifecycle_jobs leased_sibling
          join public.credential_references sibling_reference
            on sibling_reference.id = leased_sibling.credential_reference_id
           and sibling_reference.brand_id = leased_sibling.brand_id
          join public.connector_registry sibling_provider
            on sibling_provider.id = leased_sibling.provider_id
          where leased_sibling.id <> job.id
            and leased_sibling.operation = 'revoke'
            and leased_sibling.state = 'leased'
            and sibling_provider.oauth_grant_namespace
              = provider.oauth_grant_namespace
            and sibling_reference.external_account_fingerprint
              = reference.external_account_fingerprint
        )
      ))
  ), candidates as (
    select job.id, eligible.provider_key
    from eligible
    join app_private.connector_oauth_lifecycle_jobs job on job.id = eligible.id
    where eligible.grant_rank = 1
    order by eligible.next_attempt_at, eligible.created_at, eligible.id
    for update of job skip locked
    limit p_limit
  ), leased as (
    update app_private.connector_oauth_lifecycle_jobs job set
      state = 'leased', attempt_count = least(job.attempt_count + 1, 50),
      lease_token = gen_random_uuid(),
      lease_expires_at = p_now + make_interval(secs => p_lease_seconds),
      rotation_replay_deadline = job.rotation_replay_deadline,
      lease_rotation_started_at = null,
      lease_rotation_fingerprint = null,
      last_error_code = null, completed_at = null, updated_at = p_now
    from candidates
    where job.id = candidates.id
    returning job.*
  )
  select leased.id, leased.brand_id, leased.installation_id,
    leased.credential_reference_id, provider.provider_key,
    leased.credential_generation, leased.lease_token,
    app.try_connector_credential_json(secret.decrypted_secret),
    reference.account_label, reference.granted_scopes
  from leased
  join public.credential_references reference
    on reference.id = leased.credential_reference_id
   and reference.brand_id = leased.brand_id
  join public.connector_registry provider on provider.id = leased.provider_id
  join vault.decrypted_secrets secret on secret.id = reference.vault_secret_id
  order by leased.next_attempt_at, leased.created_at, leased.id;
end $function$;

select app.register_release(
  '20260911280000',
  'drop unread oauth lifecycle locals that fail schema advisors',
  'app.assert_oauth_scope_contract_default()'::regprocedure
);
