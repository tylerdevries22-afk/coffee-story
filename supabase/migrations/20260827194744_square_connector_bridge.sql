-- Bridge the proven per-location Square checkout adapter into the generic,
-- tenant-scoped connector model without breaking existing payment traffic.

insert into public.connector_installations (
  brand_id, provider_id, status, external_account_label, settings
)
select connection.brand_id,
       registry.id,
       'reauthorization_required',
       connection.merchant_id,
       jsonb_build_object('legacyConnectionId', connection.id)
  from public.square_connections connection
  join public.connector_registry registry on registry.provider_key = 'square'
on conflict (brand_id, provider_id, environment) do nothing;

insert into public.connector_location_mappings (
  brand_id, installation_id, location_id, external_location_id, external_location_label
)
select connection.brand_id,
       installation.id,
       connection.location_id,
       connection.square_location_id,
       location.name
  from public.square_connections connection
  join public.connector_registry registry on registry.provider_key = 'square'
  join public.connector_installations installation
    on installation.brand_id = connection.brand_id
   and installation.provider_id = registry.id
   and installation.environment = 'production'
  join public.locations location on location.id = connection.location_id
on conflict (installation_id, location_id) do update
  set external_location_id = excluded.external_location_id,
      external_location_label = excluded.external_location_label,
      is_active = true,
      updated_at = now();

create or replace function public.register_square_connector(
  target_brand uuid,
  target_location uuid,
  target_actor uuid,
  target_merchant text,
  target_square_location text,
  plaintext_secret text,
  target_expires_at timestamptz,
  legacy_connection uuid
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  provider uuid;
  reference uuid;
  previous_reference uuid;
  installation uuid;
  location_label text;
begin
  if not exists (
    select 1 from public.locations location
     where location.id = target_location and location.brand_id = target_brand
  ) then
    raise exception using errcode = '23503', message = 'connector_location_not_found';
  end if;
  select registry.id into provider
    from public.connector_registry registry
   where registry.provider_key = 'square' and registry.is_active;
  if provider is null then
    raise exception using errcode = '23503', message = 'connector_provider_not_found';
  end if;
  select location.name into location_label from public.locations location where location.id = target_location;

  reference := public.store_connector_secret(
    target_brand,
    'square',
    plaintext_secret,
    target_merchant,
    array['MERCHANT_PROFILE_READ','PAYMENTS_READ','PAYMENTS_WRITE','ORDERS_READ','ORDERS_WRITE'],
    target_expires_at
  );

  select existing.credential_reference_id into previous_reference
    from public.connector_installations existing
   where existing.brand_id = target_brand
     and existing.provider_id = provider
     and existing.environment = 'production';

  insert into public.connector_installations (
    brand_id, provider_id, credential_reference_id, status,
    external_account_label, connected_by, connected_at, settings
  ) values (
    target_brand, provider, reference, 'uncertified',
    target_merchant, target_actor, now(),
    jsonb_build_object('legacyConnectionId', legacy_connection)
  )
  on conflict (brand_id, provider_id, environment) do update
    set credential_reference_id = excluded.credential_reference_id,
        status = 'uncertified',
        external_account_label = excluded.external_account_label,
        connected_by = excluded.connected_by,
        connected_at = excluded.connected_at,
        disabled_at = null,
        settings = excluded.settings,
        updated_at = now()
  returning id into installation;

  insert into public.connector_location_mappings (
    brand_id, installation_id, location_id, external_location_id, external_location_label
  ) values (
    target_brand, installation, target_location, target_square_location, location_label
  )
  on conflict (installation_id, location_id) do update
    set external_location_id = excluded.external_location_id,
        external_location_label = excluded.external_location_label,
        is_active = true,
        updated_at = now();

  insert into public.connector_audit_events (
    brand_id, installation_id, location_id, actor_user_id,
    action, outcome, correlation_id, source, detail
  ) values (
    target_brand, installation, target_location, target_actor,
    'connector.connected', 'success', gen_random_uuid(), 'api',
    jsonb_build_object('provider', 'square', 'certificationState', 'uncertified')
  );

  if previous_reference is not null and previous_reference <> reference then
    perform public.revoke_connector_secret(previous_reference, target_brand);
  end if;
  return installation;
exception when others then
  if reference is not null then
    perform public.revoke_connector_secret(reference, target_brand);
  end if;
  raise;
end $$;

revoke all on function public.register_square_connector(uuid, uuid, uuid, text, text, text, timestamptz, uuid)
  from public, anon, authenticated;
grant execute on function public.register_square_connector(uuid, uuid, uuid, text, text, text, timestamptz, uuid)
  to service_role;
