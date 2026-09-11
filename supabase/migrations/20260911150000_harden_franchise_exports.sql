-- Harden franchise exports: audit brand export, bound order payload, bind guest subject.

create or replace function public.export_brand_organization_data(p_brand_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  payload jsonb;
  order_total integer;
  customer_total integer;
  order_limit constant integer := 50000;
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

  select count(*)::integer into order_total
    from public.orders ord where ord.brand_id = p_brand_id;
  select count(*)::integer into customer_total
    from public.customers customer where customer.brand_id = p_brand_id;

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
    'customers_total', customer_total,
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
    'orders_total', order_total,
    'orders_truncated', order_total > order_limit,
    'orders', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', sliced.id,
        'location_id', sliced.location_id,
        'customer_id', sliced.customer_id,
        'status', sliced.status,
        'channel', sliced.channel,
        'tender_type', sliced.tender_type,
        'fulfillment_type', sliced.fulfillment_type,
        'total_cents', sliced.total_cents,
        'placed_at', sliced.created_at
      ) order by sliced.created_at)
      from (
        select ord.id, ord.location_id, ord.customer_id, ord.status, ord.channel,
               ord.tender_type, ord.fulfillment_type, ord.total_cents, ord.created_at
          from public.orders ord
         where ord.brand_id = p_brand_id
         order by ord.created_at desc
         limit order_limit
      ) sliced
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

  insert into public.platform_access_events (
    actor_id, brand_id, location_id, action, correlation_id, metadata
  ) values (
    actor_id, p_brand_id, null, 'brands.export', pg_catalog.gen_random_uuid(),
    jsonb_build_object(
      'customers_total', customer_total,
      'orders_total', order_total,
      'orders_truncated', order_total > order_limit,
      'order_limit', order_limit,
      'surface', 'hq')
  );

  return payload;
end $$;

revoke all on function public.export_brand_organization_data(uuid) from public, anon;
grant execute on function public.export_brand_organization_data(uuid) to authenticated;

comment on function public.export_brand_organization_data(uuid) is
  'Brand-owner (or platform_admin) portability package for one organization. '
  'Writes brands.export audit. Orders are newest-first capped at 50000 with '
  'orders_total/orders_truncated markers. No credentials or raw push tokens.';

create or replace function public.export_customer_account_data(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  payload jsonb;
  jwt_role text := coalesce(auth.role(), '');
begin
  if p_user_id is null then
    raise exception using errcode = '22023', message = 'user_id_required';
  end if;

  -- Defense in depth: JWT callers may only export themselves. Service role is
  -- the HQ path after authenticate(); still require an explicit subject uuid.
  if jwt_role = 'service_role' then
    null;
  elsif auth.uid() is null or auth.uid() is distinct from p_user_id then
    raise exception using errcode = '42501', message = 'export_subject_mismatch';
  end if;

  select jsonb_build_object(
    'exported_at', pg_catalog.now(),
    'user_id', p_user_id,
    'customers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', customer.id,
        'brand_id', customer.brand_id,
        'full_name', customer.full_name,
        'email', customer.email,
        'phone', customer.phone,
        'sms_opt_in', customer.sms_opt_in,
        'created_at', customer.created_at,
        'updated_at', customer.updated_at
      ) order by customer.created_at)
      from public.customers customer
      where customer.user_id = p_user_id
    ), '[]'::jsonb),
    'orders', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ord.id,
        'brand_id', ord.brand_id,
        'location_id', ord.location_id,
        'status', ord.status,
        'channel', ord.channel,
        'tender_type', ord.tender_type,
        'fulfillment_type', ord.fulfillment_type,
        'total_cents', ord.total_cents,
        'placed_at', ord.created_at
      ) order by ord.created_at)
      from public.orders ord
      join public.customers customer on customer.id = ord.customer_id
      where customer.user_id = p_user_id
    ), '[]'::jsonb),
    'loyalty', coalesce((
      select jsonb_agg(jsonb_build_object(
        'brand_id', account.brand_id,
        'points_balance', account.points_balance,
        'lifetime_points', account.lifetime_points
      ) order by account.brand_id)
      from public.loyalty_accounts account
      join public.customers customer on customer.id = account.customer_id
      where customer.user_id = p_user_id
    ), '[]'::jsonb),
    'push_tokens', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', token.id,
        'brand_id', token.brand_id,
        'platform', token.platform,
        'created_at', token.created_at
      ) order by token.created_at)
      from public.push_tokens token
      join public.customers customer on customer.id = token.customer_id
      where customer.user_id = p_user_id
    ), '[]'::jsonb)
  ) into payload;

  return payload;
end $$;

revoke all on function public.export_customer_account_data(uuid) from public, anon, authenticated;
grant execute on function public.export_customer_account_data(uuid) to service_role;

comment on function public.export_customer_account_data(uuid) is
  'Guest portability package. service_role only after app-layer auth; JWT '
  'callers are subject-bound to auth.uid() = p_user_id.';

create or replace function app.assert_franchise_exports_hardened()
returns void language plpgsql stable security invoker set search_path = '' as $$
begin
  if pg_catalog.to_regprocedure('public.export_brand_organization_data(uuid)') is null then
    raise exception 'export_brand_organization_data is missing';
  end if;
  if pg_catalog.to_regprocedure('public.export_customer_account_data(uuid)') is null then
    raise exception 'export_customer_account_data is missing';
  end if;
  if pg_catalog.has_function_privilege('anon', 'public.export_customer_account_data(uuid)', 'execute')
     or pg_catalog.has_function_privilege('authenticated', 'public.export_customer_account_data(uuid)', 'execute') then
    raise exception 'export_customer_account_data must stay service_role only';
  end if;
end $$;

revoke all on function app.assert_franchise_exports_hardened()
  from public, anon, authenticated;
grant execute on function app.assert_franchise_exports_hardened() to service_role;

select app.register_release(
  '20260911150000',
  'harden franchise exports: audit, order cap, guest subject bind',
  'app.assert_franchise_exports_hardened()'::regprocedure
);
