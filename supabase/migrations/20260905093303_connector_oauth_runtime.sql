-- Single-use, tenant-bound OAuth admission and completion for the shared MCP store.
-- Provider tokens remain in Vault; public rows retain only opaque references.

alter table app_private.connector_oauth_states
  drop constraint if exists connector_oauth_states_redirect_uri_check;
alter table app_private.connector_oauth_states
  add constraint connector_oauth_states_redirect_uri_check check (
    redirect_uri ~ '^(https://|http://(localhost|127[.]0[.]0[.]1)(:[0-9]{1,5})?/)'
  );
create index if not exists connector_oauth_states_active_actor_idx
  on app_private.connector_oauth_states (brand_id, provider_id, requested_by)
  where consumed_at is null;

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
language plpgsql
security definer
set search_path = ''
as $$
declare v_provider_id uuid;
declare v_installation_id uuid;
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
      when public.connector_installations.status = 'connected_healthy'
        then public.connector_installations.status
      else 'connecting'
    end,
    updated_at = now()
  returning id into v_installation_id;

  update app_private.connector_oauth_states state
  set consumed_at = coalesce(state.consumed_at, now())
  where state.brand_id = p_brand_id
    and state.provider_id = v_provider_id
    and state.requested_by = p_actor_user_id
    and state.consumed_at is null;

  insert into app_private.connector_oauth_states (
    brand_id, provider_id, installation_id, requested_by, state_hash,
    pkce_verifier_reference, requested_scopes, redirect_uri, expires_at
  ) values (
    p_brand_id, v_provider_id, v_installation_id, p_actor_user_id, p_state_hash,
    p_cookie_binding_hash, p_requested_scopes, p_redirect_uri, p_expires_at
  );

  delete from app_private.connector_oauth_states
  where expires_at < now() - interval '1 day';
  return jsonb_build_object('installationId', v_installation_id);
end $$;

create or replace function public.consume_connector_oauth_state(
  p_provider_key text,
  p_actor_user_id uuid,
  p_state_hash text
) returns table (
  brand_id uuid,
  installation_id uuid,
  cookie_binding_hash text,
  requested_scopes text[],
  redirect_uri text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with consumed as (
    update app_private.connector_oauth_states state
    set consumed_at = now()
    from public.connector_registry provider
    where state.provider_id = provider.id
      and provider.provider_key = p_provider_key
      and state.requested_by = p_actor_user_id
      and state.state_hash = p_state_hash
      and state.consumed_at is null
      and state.expires_at > now()
      and exists (
        select 1 from public.brand_users member
        where member.user_id = p_actor_user_id
          and (member.role = 'platform_admin'
            or (member.brand_id = state.brand_id and member.role = 'brand_owner'))
      )
    returning state.brand_id, state.installation_id,
      state.pkce_verifier_reference, state.requested_scopes, state.redirect_uri
  )
  select consumed.brand_id, consumed.installation_id,
    consumed.pkce_verifier_reference, consumed.requested_scopes, consumed.redirect_uri
  from consumed;
end $$;

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
declare v_previous_reference uuid;
declare v_reference_id uuid;
declare v_provider_id uuid;
declare v_enabled_capabilities text[];
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
  select provider.id into v_provider_id from public.connector_registry provider
  where provider.provider_key = p_provider_key and provider.is_active;
  select installation.credential_reference_id into v_previous_reference
  from public.connector_installations installation
  where installation.id = p_installation_id
    and installation.brand_id = p_brand_id
    and installation.provider_id = v_provider_id
  for update;
  if not found then
    raise exception using errcode = '22023', message = 'connector_installation_unknown';
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
    coalesce(p_granted_scopes, '{}'), p_expires_at
  );
  update public.connector_installations set
    credential_reference_id = v_reference_id,
    status = 'connected_healthy',
    enabled_capabilities = v_enabled_capabilities,
    external_account_label = p_account_label,
    connected_by = p_actor_user_id,
    connected_at = now(),
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
    'success', gen_random_uuid(), 'hq', jsonb_build_object('provider', p_provider_key)
  );
  return v_reference_id;
end $$;

revoke all on function public.begin_connector_oauth_state(
  uuid, text, uuid, text, text, text[], text, timestamptz
) from public, anon, authenticated;
revoke all on function public.consume_connector_oauth_state(text, uuid, text)
  from public, anon, authenticated;
revoke all on function public.complete_connector_oauth_connection(
  uuid, uuid, text, uuid, jsonb, text, text[], timestamptz
) from public, anon, authenticated;
grant execute on function public.begin_connector_oauth_state(
  uuid, text, uuid, text, text, text[], text, timestamptz
) to service_role;
grant execute on function public.consume_connector_oauth_state(text, uuid, text)
  to service_role;
grant execute on function public.complete_connector_oauth_connection(
  uuid, uuid, text, uuid, jsonb, text, text[], timestamptz
) to service_role;

comment on column app_private.connector_oauth_states.pkce_verifier_reference is
  'SHA-256 digest of the HttpOnly initiating-browser binding; the PKCE verifier remains only in that cookie.';

create or replace function app.assert_connector_oauth_runtime()
returns void language plpgsql stable security invoker set search_path = '' as $$
begin
  if to_regprocedure('public.begin_connector_oauth_state(uuid,text,uuid,text,text,text[],text,timestamptz)') is null
    or to_regprocedure('public.consume_connector_oauth_state(text,uuid,text)') is null
    or to_regprocedure('public.complete_connector_oauth_connection(uuid,uuid,text,uuid,jsonb,text,text[],timestamptz)') is null
    or to_regclass('app_private.connector_oauth_states_active_actor_idx') is null
  then
    raise exception 'connector OAuth runtime contract is incomplete';
  end if;
  if has_function_privilege('anon', 'public.begin_connector_oauth_state(uuid,text,uuid,text,text,text[],text,timestamptz)', 'execute')
    or has_function_privilege('authenticated', 'public.begin_connector_oauth_state(uuid,text,uuid,text,text,text[],text,timestamptz)', 'execute')
    or has_function_privilege('anon', 'public.consume_connector_oauth_state(text,uuid,text)', 'execute')
    or has_function_privilege('authenticated', 'public.consume_connector_oauth_state(text,uuid,text)', 'execute')
    or has_function_privilege('anon', 'public.complete_connector_oauth_connection(uuid,uuid,text,uuid,jsonb,text,text[],timestamptz)', 'execute')
    or has_function_privilege('authenticated', 'public.complete_connector_oauth_connection(uuid,uuid,text,uuid,jsonb,text,text[],timestamptz)', 'execute')
  then
    raise exception 'connector OAuth runtime is reachable by a client role';
  end if;
end $$;
revoke all on function app.assert_connector_oauth_runtime()
  from public, anon, authenticated;
grant execute on function app.assert_connector_oauth_runtime() to service_role;

select app.register_release(
  '20260905093303',
  'tenant-bound connector OAuth admission, completion, and secret rotation',
  'app.assert_connector_oauth_runtime()'::regprocedure
);
