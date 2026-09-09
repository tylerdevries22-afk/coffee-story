-- Make OAuth connection health derive from durable credential evidence, add a
-- tenant-authorized disconnect boundary, and retire pre-contract Square grants.

alter table public.square_connections
  add column oauth_scope_contract_version integer not null default 1
    constraint square_connections_oauth_scope_contract_version_positive
    check (oauth_scope_contract_version > 0);

comment on column public.square_connections.oauth_scope_contract_version is
  'Scope contract proven when Square issued this grant. Version 2 includes PAYMENTS_WRITE_ADDITIONAL_RECIPIENTS.';

alter table app_private.connector_oauth_states
  add column superseded_at timestamptz
    check (superseded_at is null or superseded_at >= created_at);

drop view public.location_square_status;
drop function app.location_square_status_rows();

create function app.location_square_status_rows()
returns table (
  location_id uuid,
  brand_id uuid,
  merchant_id text,
  expires_at timestamptz,
  oauth_scope_contract_version integer
)
language sql stable security definer
set search_path = ''
as $$
  select connection.location_id, connection.brand_id,
         connection.merchant_id, connection.expires_at,
         connection.oauth_scope_contract_version
    from public.square_connections connection
   where app.is_brand_staff(connection.brand_id)
$$;
revoke execute on function app.location_square_status_rows() from public, anon;
grant execute on function app.location_square_status_rows()
  to authenticated, service_role;

create view public.location_square_status
with (security_barrier = true, security_invoker = true) as
  select * from app.location_square_status_rows();
grant select on public.location_square_status to authenticated;
revoke all on public.location_square_status from anon;
revoke insert, update, delete on public.location_square_status from authenticated;

create or replace function public.begin_connector_oauth_state(
  p_brand_id uuid,
  p_provider_key text,
  p_actor_user_id uuid,
  p_state_hash text,
  p_cookie_binding_hash text,
  p_requested_scopes text[],
  p_redirect_uri text,
  p_expires_at timestamptz
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_provider_id uuid;
  v_installation_id uuid;
begin
  if p_expires_at <= now() or p_expires_at > now() + interval '30 minutes'
    or p_state_hash !~ '^[0-9a-f]{64}$'
    or p_cookie_binding_hash !~ '^[0-9a-f]{64}$'
    or p_redirect_uri !~ '^(https://|http://(localhost|127[.]0[.]0[.]1)(:[0-9]{1,5})?/)'
    or p_requested_scopes is null
    or cardinality(p_requested_scopes) > 32
    or not exists (
      select 1 from public.brand_users member
      where member.user_id = p_actor_user_id
        and (member.role = 'platform_admin'
          or (member.brand_id = p_brand_id and member.role = 'brand_owner'))
    ) then
    raise exception using errcode = '42501', message = 'connector_oauth_forbidden';
  end if;

  select provider.id into v_provider_id
  from public.connector_registry provider
  where provider.provider_key = p_provider_key
    and provider.is_active
    and provider.availability in ('available', 'provider_approval_required');
  if v_provider_id is null then
    raise exception using errcode = '22023', message = 'connector_provider_unavailable';
  end if;

  insert into public.connector_installations (
    brand_id, provider_id, environment, status, enabled_capabilities, connected_by
  ) values (
    p_brand_id, v_provider_id, 'production', 'connecting', '{}', p_actor_user_id
  ) on conflict (brand_id, provider_id, environment) do update set
    status = case
      when public.connector_installations.credential_reference_id is not null
        then public.connector_installations.status
      else 'connecting'
    end,
    updated_at = now()
  returning id into v_installation_id;

  update app_private.connector_oauth_states state
  set consumed_at = coalesce(state.consumed_at, now()),
      superseded_at = coalesce(state.superseded_at, now())
  where state.brand_id = p_brand_id
    and state.provider_id = v_provider_id
    and state.requested_by = p_actor_user_id
    and state.superseded_at is null;

  insert into app_private.connector_oauth_states (
    brand_id, provider_id, installation_id, requested_by, state_hash,
    pkce_verifier_reference, requested_scopes, redirect_uri, expires_at
  ) values (
    p_brand_id, v_provider_id, v_installation_id, p_actor_user_id, p_state_hash,
    p_cookie_binding_hash, p_requested_scopes, p_redirect_uri, p_expires_at
  );

  delete from app_private.connector_oauth_states state
  where state.id in (
    select expired.id from app_private.connector_oauth_states expired
    where expired.expires_at < now() - interval '1 day'
    order by expired.expires_at, expired.id
    limit 500
  );
  return jsonb_build_object('installationId', v_installation_id);
end $$;

revoke all on function public.begin_connector_oauth_state(
  uuid, text, uuid, text, text, text[], text, timestamptz
) from public, anon, authenticated;
grant execute on function public.begin_connector_oauth_state(
  uuid, text, uuid, text, text, text[], text, timestamptz
) to service_role;

create or replace function public.complete_connector_oauth_connection(
  p_brand_id uuid,
  p_installation_id uuid,
  p_provider_key text,
  p_actor_user_id uuid,
  p_credential jsonb,
  p_account_label text,
  p_granted_scopes text[],
  p_expires_at timestamptz
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous_reference uuid;
  v_reference_id uuid;
  v_provider_id uuid;
  v_enabled_capabilities text[];
  v_requested_scopes text[];
  v_state_consumed_at timestamptz;
begin
  if jsonb_typeof(p_credential) <> 'object'
    or pg_column_size(p_credential) > 24576
    or jsonb_typeof(p_credential->'access_token') <> 'string'
    or length(p_credential->>'access_token') not between 8 and 16384
    or p_account_label is null
    or length(btrim(p_account_label)) not between 1 and 160
    or p_granted_scopes is null
    or cardinality(p_granted_scopes) > 32
    or (p_expires_at is not null and p_expires_at <= now())
    or not exists (
      select 1 from public.brand_users member
      where member.user_id = p_actor_user_id
        and (member.role = 'platform_admin'
          or (member.brand_id = p_brand_id and member.role = 'brand_owner'))
    ) then
    raise exception using errcode = '42501', message = 'connector_oauth_forbidden';
  end if;

  select provider.id into v_provider_id
  from public.connector_registry provider
  where provider.provider_key = p_provider_key;
  if v_provider_id is null then
    raise exception using errcode = '22023', message = 'connector_provider_unavailable';
  end if;

  select installation.credential_reference_id into v_previous_reference
  from public.connector_installations installation
  where installation.id = p_installation_id
    and installation.brand_id = p_brand_id
    and installation.provider_id = v_provider_id
  for update;
  if not found then
    raise exception using errcode = '22023', message = 'connector_installation_unknown';
  end if;

  perform 1
  from public.connector_registry provider
  where provider.id = v_provider_id
    and provider.is_active
    and provider.availability in ('available', 'provider_approval_required')
  for share;
  if not found then
    raise exception using errcode = '22023', message = 'connector_provider_unavailable';
  end if;

  select state.requested_scopes, state.consumed_at
  into v_requested_scopes, v_state_consumed_at
  from app_private.connector_oauth_states state
  where state.installation_id = p_installation_id
    and state.brand_id = p_brand_id
    and state.requested_by = p_actor_user_id
    and state.superseded_at is null
    and state.expires_at > now()
  order by state.created_at desc, state.id desc
  limit 1;
  if not found or v_state_consumed_at is null then
    raise exception using errcode = '22023', message = 'connector_oauth_state_incomplete';
  end if;
  if not v_requested_scopes <@ p_granted_scopes then
    raise exception using errcode = '22023', message = 'connector_oauth_scope_grant_incomplete';
  end if;

  select coalesce(array_agg(capability.capability_key order by capability.capability_key), '{}')
  into v_enabled_capabilities
  from public.connector_capabilities capability
  where capability.provider_id = v_provider_id
    and capability.is_active
    and (cardinality(capability.oauth_scopes) = 0
      or capability.oauth_scopes <@ p_granted_scopes);

  v_reference_id := public.store_connector_secret(
    p_brand_id, p_provider_key, p_credential::text, p_account_label,
    p_granted_scopes, p_expires_at
  );
  update public.connector_installations set
    credential_reference_id = v_reference_id,
    status = case when p_expires_at is not null
      and p_expires_at <= now() + interval '7 days'
      then 'connected_degraded' else 'connected_healthy' end,
    enabled_capabilities = v_enabled_capabilities,
    external_account_label = p_account_label,
    settings = settings || jsonb_build_object(
      'oauthRequestedScopes', to_jsonb(v_requested_scopes)
    ),
    connected_by = p_actor_user_id,
    connected_at = now(),
    disabled_at = null,
    updated_at = now()
  where id = p_installation_id and brand_id = p_brand_id;

  if v_previous_reference is not null and v_previous_reference <> v_reference_id then
    perform public.revoke_connector_secret(v_previous_reference, p_brand_id);
  end if;
  insert into public.connector_audit_events (
    brand_id, installation_id, actor_user_id, action, outcome,
    correlation_id, source, detail
  ) values (
    p_brand_id, p_installation_id, p_actor_user_id, 'oauth.connected',
    'success', gen_random_uuid(), 'hq', jsonb_build_object(
      'provider', p_provider_key,
      'requestedScopeCount', cardinality(v_requested_scopes),
      'grantedScopeCount', cardinality(p_granted_scopes)
    )
  );
  return v_reference_id;
exception when others then
  if v_reference_id is not null then
    perform public.revoke_connector_secret(v_reference_id, p_brand_id);
  end if;
  raise;
end $$;

revoke all on function public.complete_connector_oauth_connection(
  uuid, uuid, text, uuid, jsonb, text, text[], timestamptz
) from public, anon, authenticated;
grant execute on function public.complete_connector_oauth_connection(
  uuid, uuid, text, uuid, jsonb, text, text[], timestamptz
) to service_role;

create or replace function public.reconcile_connector_credential_status(
  p_now timestamptz default now(),
  p_limit integer default 100
) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  changed_count integer;
begin
  if p_now is null then
    raise exception using errcode = '22023', message = 'connector_reconcile_time_invalid';
  end if;
  if p_limit is null or p_limit not between 1 and 500 then
    raise exception using errcode = '22023', message = 'connector_reconcile_limit_invalid';
  end if;

  with candidates as (
    select installation.id, installation.status as previous_status,
      decision.next_status
    from public.connector_installations installation
    join public.connector_registry provider on provider.id = installation.provider_id
    left join public.credential_references reference
      on reference.id = installation.credential_reference_id
     and reference.brand_id = installation.brand_id
    cross join lateral (
      select case
        when installation.status = 'connecting' and not exists (
          select 1 from app_private.connector_oauth_states state
          where state.installation_id = installation.id
            and state.brand_id = installation.brand_id
            and state.superseded_at is null
            and state.expires_at > p_now
        ) then case when reference.id is null
          then 'setup_required' else 'reauthorization_required' end
        when installation.status <> 'connecting' and (
          reference.id is null or reference.revoked_at is not null
          or (reference.expires_at is not null and reference.expires_at <= p_now)
        )
          then 'reauthorization_required'
        when installation.status <> 'connecting' and (
          cardinality(installation.enabled_capabilities) = 0
          or exists (
            select 1
            from unnest(installation.enabled_capabilities) enabled(capability_key)
            where not exists (
              select 1
              from public.connector_capabilities capability
              join public.connector_certifications certification
                on certification.capability_id = capability.id
              where capability.provider_id = installation.provider_id
                and capability.capability_key = enabled.capability_key
                and capability.is_active
                and (cardinality(capability.oauth_scopes) = 0
                  or capability.oauth_scopes <@ reference.granted_scopes)
                and certification.environment = 'sandbox'
                and certification.status = 'passed'
                and certification.certified_at is not null
                and (certification.valid_until is null or certification.valid_until > p_now)
            )
          )
        ) then 'reauthorization_required'
        when installation.status <> 'connecting' and provider.provider_key in (
          'google-suite', 'stripe', 'quickbooks-online', 'slack',
          'meta-business-suite', 'youtube', 'tiktok'
        ) and (
          jsonb_typeof(installation.settings->'oauthRequestedScopes') is distinct from 'array'
          or not (
            (installation.settings->'oauthRequestedScopes')
              <@ to_jsonb(reference.granted_scopes)
          )
        ) then 'reauthorization_required'
        when installation.status = 'connected_healthy'
          and reference.expires_at <= p_now + interval '7 days'
          then 'connected_degraded'
        else installation.status
      end as next_status
    ) decision
    where installation.status in ('connecting', 'connected_healthy', 'connected_degraded')
      and installation.status <> decision.next_status
    order by reference.expires_at nulls last, installation.id
    for update of installation skip locked
    limit p_limit
  ), changed as (
    update public.connector_installations installation
    set status = candidates.next_status,
        enabled_capabilities = case
          when candidates.next_status in ('setup_required', 'reauthorization_required') then '{}'
          else installation.enabled_capabilities end,
        updated_at = p_now
    from candidates
    where installation.id = candidates.id
      and installation.status <> candidates.next_status
    returning installation.id, installation.brand_id,
      candidates.previous_status, installation.status as next_status
  ), audited as (
    insert into public.connector_audit_events (
      brand_id, installation_id, action, outcome, correlation_id, source, detail
    )
    select changed.brand_id, changed.id, 'credential.status_changed', 'success',
      gen_random_uuid(), 'cron', jsonb_build_object(
        'previousStatus', changed.previous_status,
        'status', changed.next_status
      )
    from changed
    returning 1
  )
  select count(*)::integer into changed_count from audited;
  return changed_count;
end $$;

create or replace function public.disconnect_connector_oauth_connection(
  p_brand_id uuid,
  p_provider_key text,
  p_actor_user_id uuid
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  installation public.connector_installations%rowtype;
  provider_id uuid;
  secret_revoked boolean := false;
  vault_secret_id uuid;
  vault_secret_absent boolean := true;
begin
  if p_brand_id is null or p_actor_user_id is null
    or p_provider_key is null or length(p_provider_key) not between 1 and 80
    or not exists (
      select 1 from public.brand_users member
      where member.user_id = p_actor_user_id
        and (member.role = 'platform_admin'
          or (member.brand_id = p_brand_id and member.role = 'brand_owner'))
    ) then
    raise exception using errcode = '42501', message = 'connector_oauth_forbidden';
  end if;

  select provider.id into provider_id
  from public.connector_registry provider
  where provider.provider_key = p_provider_key;
  if provider_id is null then return false; end if;

  select target.* into installation
  from public.connector_installations target
  where target.brand_id = p_brand_id
    and target.provider_id = provider_id
    and target.environment = 'production'
  for update;
  if not found then return false; end if;

  update app_private.connector_oauth_states state
  set consumed_at = coalesce(state.consumed_at, now()),
      superseded_at = coalesce(state.superseded_at, now())
  where state.installation_id = installation.id
    and state.brand_id = p_brand_id
    and state.superseded_at is null;

  if installation.status = 'revoked'
    and installation.credential_reference_id is null then
    return true;
  end if;

  if installation.credential_reference_id is not null then
    select reference.vault_secret_id into vault_secret_id
    from public.credential_references reference
    where reference.id = installation.credential_reference_id
      and reference.brand_id = p_brand_id;
    secret_revoked := public.revoke_connector_secret(
      installation.credential_reference_id, p_brand_id
    );
    if vault_secret_id is not null then
      select not exists (
        select 1 from vault.secrets secret where secret.id = vault_secret_id
      ) into vault_secret_absent;
    end if;
  end if;

  update public.connector_installations set
    credential_reference_id = null,
    status = 'revoked',
    enabled_capabilities = '{}',
    external_account_label = '',
    connected_by = null,
    connected_at = null,
    last_synced_at = null,
    disabled_at = coalesce(disabled_at, now()),
    updated_at = now()
  where id = installation.id;
  update public.connector_location_mappings
  set is_active = false, updated_at = now()
  where installation_id = installation.id and brand_id = p_brand_id and is_active;

  if installation.status <> 'revoked'
    or installation.credential_reference_id is not null then
    insert into public.connector_audit_events (
      brand_id, installation_id, actor_user_id, action, outcome,
      correlation_id, source, detail
    ) values (
      p_brand_id, installation.id, p_actor_user_id, 'oauth.disconnected',
      'success', gen_random_uuid(), 'hq', jsonb_build_object(
        'provider', p_provider_key,
        'credentialReferenceRevoked', secret_revoked,
        'vaultSecretAbsent', vault_secret_absent
      )
    );
  end if;
  return true;
end $$;

revoke all on function public.reconcile_connector_credential_status(timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.reconcile_connector_credential_status(timestamptz, integer)
  to service_role;
revoke all on function public.disconnect_connector_oauth_connection(uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.disconnect_connector_oauth_connection(uuid, text, uuid)
  to service_role;

create or replace function app.assert_connector_credential_lifecycle()
returns void language plpgsql stable security invoker set search_path = '' as $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'square_connections'
      and column_name = 'oauth_scope_contract_version'
      and is_nullable = 'NO' and column_default = '1'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'location_square_status'
      and column_name = 'oauth_scope_contract_version'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'app_private' and table_name = 'connector_oauth_states'
      and column_name = 'superseded_at'
  ) then
    raise exception 'connector credential lifecycle columns are missing';
  end if;
  if pg_catalog.to_regprocedure(
      'public.reconcile_connector_credential_status(timestamptz,integer)'
    ) is null
    or pg_catalog.to_regprocedure(
      'public.disconnect_connector_oauth_connection(uuid,text,uuid)'
    ) is null then
    raise exception 'connector credential lifecycle RPCs are missing';
  end if;
  if has_function_privilege('anon',
      'public.disconnect_connector_oauth_connection(uuid,text,uuid)', 'execute')
    or has_function_privilege('authenticated',
      'public.disconnect_connector_oauth_connection(uuid,text,uuid)', 'execute')
    or has_function_privilege('anon',
      'public.reconcile_connector_credential_status(timestamptz,integer)', 'execute')
    or has_function_privilege('authenticated',
      'public.reconcile_connector_credential_status(timestamptz,integer)', 'execute') then
    raise exception 'connector credential lifecycle RPCs are client reachable';
  end if;
  if not has_function_privilege('service_role',
      'public.disconnect_connector_oauth_connection(uuid,text,uuid)', 'execute')
    or not has_function_privilege('service_role',
      'public.reconcile_connector_credential_status(timestamptz,integer)', 'execute') then
    raise exception 'connector credential lifecycle RPCs are unavailable to service role';
  end if;
end $$;
revoke all on function app.assert_connector_credential_lifecycle()
  from public, anon, authenticated;
grant execute on function app.assert_connector_credential_lifecycle() to service_role;

select app.register_release(
  '20260908228000',
  'connector credential lifecycle and Square OAuth scope contract',
  'app.assert_connector_credential_lifecycle()'::regprocedure
);
