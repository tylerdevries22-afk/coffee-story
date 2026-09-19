-- ACTZ partner provision path: service_role only (no platform_admin browser session).
-- Idempotent on brands.actz_provider_org_id. Does not go-live.

create or replace function public.provision_actz_partner_organization(
  p_idempotency_key uuid,
  p_actz_provider_org_id text,
  p_name text,
  p_slug text,
  p_industry_key text default 'hospitality',
  p_location_name text default null,
  p_location_timezone text default 'America/Denver'
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_id uuid;
  existing_slug text;
  created_brand_id uuid;
  created_location_id uuid;
  cleaned_org text := nullif(btrim(p_actz_provider_org_id), '');
  cleaned_name text := nullif(btrim(p_name), '');
  cleaned_slug text := nullif(btrim(p_slug), '');
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'actz_partner_service_role_required';
  end if;
  if p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'idempotency_key_required';
  end if;
  if cleaned_org is null or length(cleaned_org) < 8 or length(cleaned_org) > 128 then
    raise exception using errcode = '22023', message = 'actz_provider_org_id_invalid';
  end if;
  if cleaned_name is null or length(cleaned_name) < 2 or length(cleaned_name) > 120 then
    raise exception using errcode = '22023', message = 'name_invalid';
  end if;
  if cleaned_slug is null or cleaned_slug !~ '^[a-z0-9][a-z0-9-]{1,62}$' then
    raise exception using errcode = '22023', message = 'slug_invalid';
  end if;

  select brand.id, brand.slug into existing_id, existing_slug
  from public.brands brand
  where brand.actz_provider_org_id = cleaned_org;
  if existing_id is not null then
    return jsonb_build_object(
      'brandId', existing_id,
      'slug', existing_slug,
      'actzProviderOrgId', cleaned_org,
      'replayed', true,
      'status', 'sandbox'
    );
  end if;

  insert into public.brands (name, slug, actz_provider_org_id, brand_config)
  values (
    cleaned_name,
    cleaned_slug,
    cleaned_org,
    jsonb_build_object(
      'source', 'actz_partner',
      'industryKey', coalesce(nullif(btrim(p_industry_key), ''), 'hospitality'),
      'idempotencyKey', p_idempotency_key
    )
  )
  returning id into created_brand_id;

  if p_location_name is not null and length(btrim(p_location_name)) between 1 and 120 then
    insert into public.locations (brand_id, name, timezone)
    values (
      created_brand_id,
      btrim(p_location_name),
      coalesce(nullif(btrim(p_location_timezone), ''), 'America/Denver')
    )
    returning id into created_location_id;
  end if;

  return jsonb_build_object(
    'brandId', created_brand_id,
    'locationId', created_location_id,
    'slug', cleaned_slug,
    'actzProviderOrgId', cleaned_org,
    'replayed', false,
    'status', 'sandbox'
  );
exception
  when unique_violation then
    select brand.id, brand.slug into existing_id, existing_slug
    from public.brands brand
    where brand.actz_provider_org_id = cleaned_org
       or brand.slug = cleaned_slug;
    if existing_id is not null and exists (
      select 1 from public.brands b where b.id = existing_id and b.actz_provider_org_id = cleaned_org
    ) then
      return jsonb_build_object(
        'brandId', existing_id,
        'slug', existing_slug,
        'actzProviderOrgId', cleaned_org,
        'replayed', true,
        'status', 'sandbox'
      );
    end if;
    raise exception using errcode = '23505', message = 'slug_or_mapping_conflict';
end;
$$;

revoke all on function public.provision_actz_partner_organization(
  uuid, text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.provision_actz_partner_organization(
  uuid, text, text, text, text, text, text
) to service_role;

comment on function public.provision_actz_partner_organization(
  uuid, text, text, text, text, text, text
) is
  'ACTZ partner create-org (service_role). Idempotent on actz_provider_org_id. Never go-live.';

create function app.assert_actz_partner_provision()
returns void language plpgsql stable security invoker set search_path = '' as $$
begin
  if to_regprocedure(
    'public.provision_actz_partner_organization(uuid,text,text,text,text,text,text)'
  ) is null then
    raise exception 'provision_actz_partner_organization missing';
  end if;
end $$;

revoke all on function app.assert_actz_partner_provision() from public, anon, authenticated;
grant execute on function app.assert_actz_partner_provision() to service_role;

select app.register_release(
  '20260919020000',
  'ACTZ partner provision RPC (service_role, idempotent, no go-live)',
  'app.assert_actz_partner_provision()'::regprocedure
);
