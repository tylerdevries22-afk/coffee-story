-- Adds MCP Store selections to the existing atomic organization provisioner.
-- The original RPC remains available for older clients; this wrapper reuses it
-- and commits connector setup rows in the same database transaction.
create or replace function public.provision_platform_organization_with_connectors(
  p_idempotency_key uuid,
  p_name text,
  p_slug text,
  p_owner_user_id uuid,
  p_owner_email text,
  p_organization_kind text,
  p_industry_key text,
  p_blueprint_key text,
  p_brand_config jsonb,
  p_location jsonb,
  p_modules jsonb,
  p_network_slug text,
  p_territory jsonb,
  p_inheritance_policy jsonb,
  p_connectors jsonb,
  p_fee_bps integer default 200,
  p_fee_bps_tier2 integer default 150,
  p_tier_threshold_cents bigint default 2500000
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare provisioned jsonb;
declare created_brand_id uuid;
declare normalized_connectors jsonb;
declare stored_connectors jsonb;
begin
  if jsonb_typeof(coalesce(p_connectors, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_connectors, '[]'::jsonb)) > 32
     or exists (
       select 1 from jsonb_array_elements(coalesce(p_connectors, '[]'::jsonb)) item(value)
       where jsonb_typeof(item.value) <> 'string'
     ) then
    raise exception using errcode = '22023', message = 'invalid_connector_selection';
  end if;

  select coalesce(jsonb_agg(requested.provider_key order by requested.provider_key), '[]'::jsonb)
  into normalized_connectors
  from (
    select distinct jsonb_array_elements_text(coalesce(p_connectors, '[]'::jsonb)) as provider_key
  ) requested;

  if exists (
    select 1 from jsonb_array_elements_text(normalized_connectors) requested(provider_key)
    where not exists (
      select 1 from public.connector_registry provider
      where provider.provider_key = requested.provider_key
        and provider.is_active
        and provider.availability not in ('disabled', 'coming_soon', 'uncertified')
    )
  ) then
    raise exception using errcode = '22023', message = 'unknown_connector_selection';
  end if;

  provisioned := public.provision_platform_organization(
    p_idempotency_key, p_name, p_slug, p_owner_user_id, p_owner_email,
    p_organization_kind, p_industry_key, p_blueprint_key, p_brand_config,
    p_location, p_modules, p_network_slug, p_territory, p_inheritance_policy,
    p_fee_bps, p_fee_bps_tier2, p_tier_threshold_cents
  );
  created_brand_id := (provisioned->>'brandId')::uuid;

  select run.request->'connectorIds' into stored_connectors
  from public.organization_provisioning_runs run
  where run.idempotency_key = p_idempotency_key
  for update;
  if stored_connectors is not null and stored_connectors <> normalized_connectors then
    raise exception using errcode = '22023', message = 'idempotency_key_payload_mismatch';
  end if;
  update public.organization_provisioning_runs run
  set request = run.request || jsonb_build_object('connectorIds', normalized_connectors)
  where run.idempotency_key = p_idempotency_key;

  with inserted as (
    insert into public.connector_installations (
      brand_id, provider_id, environment, status, enabled_capabilities, settings,
      connected_by
    )
    select created_brand_id, provider.id, 'production',
      case provider.availability
        when 'provider_approval_required' then 'provider_approval_required'
        else 'setup_required'
      end,
      '{}'::text[], '{}'::jsonb, (select auth.uid())
    from public.connector_registry provider
    join jsonb_array_elements_text(normalized_connectors) requested(provider_key)
      on requested.provider_key = provider.provider_key
    on conflict (brand_id, provider_id, environment) do nothing
    returning id, provider_id
  )
  insert into public.connector_audit_events (
    brand_id, installation_id, actor_user_id, action, outcome,
    correlation_id, source, detail
  )
  select created_brand_id, inserted.id, (select auth.uid()), 'installation.selected',
    'success', p_idempotency_key, 'hq',
    jsonb_build_object('providerId', inserted.provider_id, 'stage', 'onboarding')
  from inserted;

  return provisioned || jsonb_build_object(
    'connectorCount', jsonb_array_length(normalized_connectors)
  );
end $$;

revoke all on function public.provision_platform_organization_with_connectors(
  uuid, text, text, uuid, text, text, text, text, jsonb, jsonb, jsonb,
  text, jsonb, jsonb, jsonb, integer, integer, bigint
) from public, anon;
grant execute on function public.provision_platform_organization_with_connectors(
  uuid, text, text, uuid, text, text, text, text, jsonb, jsonb, jsonb,
  text, jsonb, jsonb, jsonb, integer, integer, bigint
) to authenticated, service_role;
