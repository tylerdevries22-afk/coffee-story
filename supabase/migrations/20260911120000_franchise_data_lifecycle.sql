-- Franchise data lifecycle: guest data export, brand offboarding, safe location delete.
-- Complements suspend/restore (reversible) and anonymize_customer_account (guest delete).

-- ---------------------------------------------------------------------------
-- Guest portability: one JSON document of everything keyed to the caller's user.
-- service_role only — the HQ API authenticates the bearer, then invokes this.
-- ---------------------------------------------------------------------------
create or replace function public.export_customer_account_data(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  payload jsonb;
begin
  if p_user_id is null then
    raise exception using errcode = '22023', message = 'user_id_required';
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
  'Assembles a guest portability package for one auth user: customer rows, '
  'orders, loyalty balances, and push token metadata (never the raw token). '
  'service_role only; HQ authenticates first.';

-- ---------------------------------------------------------------------------
-- Brand offboarding: terminal lifecycle step after suspension.
-- platform_admin only; deletes nothing — status becomes offboarded and access ends.
-- ---------------------------------------------------------------------------
create or replace function public.offboard_brand(p_brand_id uuid, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  current_status text;
  installation record;
  devices integer := 0;
  grants_revoked integer := 0;
begin
  if actor_id is null or not exists (
    select 1 from public.brand_users member
    where member.user_id = actor_id and member.role = 'platform_admin'
  ) then
    raise exception using errcode = '42501', message = 'platform_actor_required';
  end if;
  if pg_catalog.length(pg_catalog.btrim(coalesce(p_reason, ''))) not between 4 and 500 then
    raise exception using errcode = '22023', message = 'invalid_offboard_reason';
  end if;

  select brand.status into current_status
    from public.brands brand
   where brand.id = p_brand_id
     for update;
  if not found then
    raise exception using errcode = '23503', message = 'platform_brand_not_found';
  end if;
  if current_status = 'offboarded' then
    return false;
  end if;
  if current_status = 'provisioning' then
    raise exception using errcode = '22023', message = 'brand_still_provisioning';
  end if;

  update public.brands brand set status = 'offboarded' where brand.id = p_brand_id;

  for installation in
    select target.id from public.device_installations target
     where target.brand_id = p_brand_id and target.revoked_at is null
     order by target.id
       for update
  loop
    perform app.revoke_device_installation(installation.id, p_brand_id);
    devices := devices + 1;
  end loop;

  update public.delegated_access_grants grant_row
     set revoked_at = pg_catalog.now()
   where grant_row.brand_id = p_brand_id and grant_row.revoked_at is null;
  get diagnostics grants_revoked = row_count;

  insert into public.platform_access_events (
    actor_id, brand_id, location_id, action, correlation_id, metadata
  ) values (
    actor_id, p_brand_id, null, 'brands.offboard', pg_catalog.gen_random_uuid(),
    jsonb_build_object(
      'reason', pg_catalog.btrim(p_reason),
      'from_status', current_status,
      'to_status', 'offboarded',
      'devices_revoked', devices,
      'grants_revoked', grants_revoked,
      'surface', 'hq')
  );
  return true;
end $$;

revoke all on function public.offboard_brand(uuid, text) from public, anon;
grant execute on function public.offboard_brand(uuid, text) to authenticated;

comment on function public.offboard_brand(uuid, text) is
  'Terminal brand lifecycle step: status to offboarded, devices and delegated '
  'grants revoked, one audit row. platform_admin only. Does not hard-delete '
  'rows; purge remains a separate, deliberate operator procedure.';

-- ---------------------------------------------------------------------------
-- Location delete: brand_owner may remove a store that is not the last one.
-- ---------------------------------------------------------------------------
create or replace function public.delete_location_if_allowed(p_location_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_brand uuid;
  remaining integer;
begin
  select location.brand_id into target_brand
    from public.locations location
   where location.id = p_location_id
     for update;
  if not found then
    raise exception using errcode = '23503', message = 'location_not_found';
  end if;
  if not app.is_brand_owner(target_brand) then
    raise exception using errcode = '42501', message = 'brand_owner_required';
  end if;

  select count(*)::integer into remaining
    from public.locations location
   where location.brand_id = target_brand;
  if remaining <= 1 then
    raise exception using errcode = '22023', message = 'last_location_protected';
  end if;

  delete from public.locations location where location.id = p_location_id;
  return true;
end $$;

revoke all on function public.delete_location_if_allowed(uuid) from public, anon;
grant execute on function public.delete_location_if_allowed(uuid) to authenticated;

comment on function public.delete_location_if_allowed(uuid) is
  'Deletes one location when the caller is brand_owner and at least one other '
  'location remains. Cascades device/order FKs already declared on locations.';

-- ---------------------------------------------------------------------------
-- Release registry: newest migration must advance platform_release_readiness.
-- ---------------------------------------------------------------------------
create or replace function app.assert_franchise_data_lifecycle()
returns void language plpgsql stable security invoker set search_path = '' as $$
begin
  if pg_catalog.to_regprocedure('public.export_customer_account_data(uuid)') is null then
    raise exception 'export_customer_account_data is missing';
  end if;
  if pg_catalog.has_function_privilege('anon', 'public.export_customer_account_data(uuid)', 'execute')
     or pg_catalog.has_function_privilege('authenticated', 'public.export_customer_account_data(uuid)', 'execute') then
    raise exception 'export_customer_account_data must stay service_role only';
  end if;
  if not pg_catalog.has_function_privilege('service_role', 'public.export_customer_account_data(uuid)', 'execute') then
    raise exception 'export_customer_account_data must be executable by service_role';
  end if;
  if pg_catalog.to_regprocedure('public.offboard_brand(uuid, text)') is null then
    raise exception 'offboard_brand is missing';
  end if;
  if pg_catalog.has_function_privilege('anon', 'public.offboard_brand(uuid, text)', 'execute') then
    raise exception 'offboard_brand must not be executable by anon';
  end if;
  if pg_catalog.to_regprocedure('public.delete_location_if_allowed(uuid)') is null then
    raise exception 'delete_location_if_allowed is missing';
  end if;
  if pg_catalog.has_function_privilege('anon', 'public.delete_location_if_allowed(uuid)', 'execute') then
    raise exception 'delete_location_if_allowed must not be executable by anon';
  end if;
end $$;

revoke all on function app.assert_franchise_data_lifecycle()
  from public, anon, authenticated;
grant execute on function app.assert_franchise_data_lifecycle() to service_role;

select app.register_release(
  '20260911120000',
  'franchise data lifecycle: guest export, brand offboard, protected location delete',
  'app.assert_franchise_data_lifecycle()'::regprocedure
);
