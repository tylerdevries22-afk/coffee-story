-- Harden location delete: refuse stores with commerce history, audit the attempt.
-- Hard DELETE still cascades for empty locations (pairing/devices only).

create or replace function public.delete_location_if_allowed(p_location_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_brand uuid;
  remaining integer;
  order_count integer;
  actor_id uuid := auth.uid();
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

  select count(*)::integer into order_count
    from public.orders ord
   where ord.location_id = p_location_id;
  if order_count > 0 then
    raise exception using errcode = '22023', message = 'location_has_commerce_history';
  end if;

  insert into public.platform_access_events (
    actor_id, brand_id, location_id, action, correlation_id, metadata
  ) values (
    actor_id, target_brand, p_location_id, 'locations.delete', pg_catalog.gen_random_uuid(),
    jsonb_build_object(
      'location_id', p_location_id,
      'order_count', order_count,
      'surface', 'hq')
  );

  delete from public.locations location where location.id = p_location_id;
  return true;
end $$;

revoke all on function public.delete_location_if_allowed(uuid) from public, anon;
grant execute on function public.delete_location_if_allowed(uuid) to authenticated;

comment on function public.delete_location_if_allowed(uuid) is
  'Deletes one empty location when the caller is brand_owner, another location '
  'remains, and the store has no orders. Writes locations.delete audit first. '
  'Locations with commerce history must be offboarded or archived, not cascaded.';

create or replace function app.assert_location_delete_hardened()
returns void language plpgsql stable security invoker set search_path = '' as $$
begin
  if pg_catalog.to_regprocedure('public.delete_location_if_allowed(uuid)') is null then
    raise exception 'delete_location_if_allowed is missing';
  end if;
  if pg_catalog.has_function_privilege('anon', 'public.delete_location_if_allowed(uuid)', 'execute') then
    raise exception 'delete_location_if_allowed must not be executable by anon';
  end if;
end $$;

revoke all on function app.assert_location_delete_hardened()
  from public, anon, authenticated;
grant execute on function app.assert_location_delete_hardened() to service_role;

select app.register_release(
  '20260911140000',
  'harden location delete: block commerce cascade, audit locations.delete',
  'app.assert_location_delete_hardened()'::regprocedure
);
