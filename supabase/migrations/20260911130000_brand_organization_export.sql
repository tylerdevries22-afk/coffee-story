-- Brand-owner org-wide data export (portability package for the tenant).
-- Complements guest export_customer_account_data.

create or replace function public.export_brand_organization_data(p_brand_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  payload jsonb;
begin
  if actor_id is null then
    raise exception using errcode = '42501', message = 'authenticated_actor_required';
  end if;
  if p_brand_id is null then
    raise exception using errcode = '22023', message = 'brand_id_required';
  end if;
  if not (
    app.is_brand_owner(p_brand_id)
    or exists (
      select 1 from public.brand_users member
      where member.user_id = actor_id and member.role = 'platform_admin'
    )
  ) then
    raise exception using errcode = '42501', message = 'brand_owner_required';
  end if;
  if not exists (select 1 from public.brands brand where brand.id = p_brand_id) then
    raise exception using errcode = '23503', message = 'platform_brand_not_found';
  end if;

  select jsonb_build_object(
    'exported_at', pg_catalog.now(),
    'brand', (
      select jsonb_build_object(
        'id', brand.id,
        'name', brand.name,
        'slug', brand.slug,
        'status', brand.status,
        'organization_kind', brand.organization_kind,
        'industry_key', brand.industry_key,
        'blueprint_key', brand.blueprint_key,
        'created_at', brand.created_at
      )
      from public.brands brand
      where brand.id = p_brand_id
    ),
    'locations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', location.id,
        'name', location.name,
        'address', location.address,
        'hours', location.hours,
        'timezone', location.timezone,
        'ordering_paused', location.ordering_paused,
        'created_at', location.created_at
      ) order by location.created_at)
      from public.locations location
      where location.brand_id = p_brand_id
    ), '[]'::jsonb),
    'staff', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', member.user_id,
        'role', member.role,
        'location_ids', member.location_ids,
        'created_at', member.created_at
      ) order by member.created_at)
      from public.brand_users member
      where member.brand_id = p_brand_id
        and member.role is distinct from 'platform_admin'
    ), '[]'::jsonb),
    'customers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', customer.id,
        'full_name', customer.full_name,
        'email', customer.email,
        'phone', customer.phone,
        'sms_opt_in', customer.sms_opt_in,
        'created_at', customer.created_at
      ) order by customer.created_at)
      from public.customers customer
      where customer.brand_id = p_brand_id
    ), '[]'::jsonb),
    'orders', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ord.id,
        'location_id', ord.location_id,
        'customer_id', ord.customer_id,
        'status', ord.status,
        'channel', ord.channel,
        'tender_type', ord.tender_type,
        'fulfillment_type', ord.fulfillment_type,
        'total_cents', ord.total_cents,
        'placed_at', ord.created_at
      ) order by ord.created_at)
      from public.orders ord
      where ord.brand_id = p_brand_id
    ), '[]'::jsonb),
    'loyalty', coalesce((
      select jsonb_agg(jsonb_build_object(
        'customer_id', account.customer_id,
        'points_balance', account.points_balance,
        'lifetime_points', account.lifetime_points
      ) order by account.customer_id)
      from public.loyalty_accounts account
      where account.brand_id = p_brand_id
    ), '[]'::jsonb)
  ) into payload;

  return payload;
end $$;

revoke all on function public.export_brand_organization_data(uuid) from public, anon;
grant execute on function public.export_brand_organization_data(uuid) to authenticated;

comment on function public.export_brand_organization_data(uuid) is
  'Brand-owner (or platform_admin) portability package for one organization: '
  'brand row, locations, staff memberships, customers, orders, and loyalty. '
  'Does not include credentials, Square tokens, or raw push tokens.';

create or replace function app.assert_brand_organization_export()
returns void language plpgsql stable security invoker set search_path = '' as $$
begin
  if pg_catalog.to_regprocedure('public.export_brand_organization_data(uuid)') is null then
    raise exception 'export_brand_organization_data is missing';
  end if;
  if pg_catalog.has_function_privilege('anon', 'public.export_brand_organization_data(uuid)', 'execute') then
    raise exception 'export_brand_organization_data must not be executable by anon';
  end if;
  if not pg_catalog.has_function_privilege('authenticated', 'public.export_brand_organization_data(uuid)', 'execute') then
    raise exception 'export_brand_organization_data must be executable by authenticated';
  end if;
end $$;

revoke all on function app.assert_brand_organization_export()
  from public, anon, authenticated;
grant execute on function app.assert_brand_organization_export() to service_role;

select app.register_release(
  '20260911130000',
  'brand-owner organization data export for franchise portability',
  'app.assert_brand_organization_export()'::regprocedure
);
