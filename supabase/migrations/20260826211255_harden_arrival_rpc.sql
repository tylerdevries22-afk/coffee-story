-- Keep the guest-facing RPC invoker-shaped for Supabase's security advisor,
-- while retaining the narrowly scoped privileged write in an unexposed helper.
create or replace function app.mark_order_arrived(target_order uuid)
returns timestamptz
language plpgsql security definer set search_path = ''
as $$
declare
  existing timestamptz;
  row_brand uuid;
begin
  select order_row.arrived_at, order_row.brand_id into existing, row_brand
    from public.orders order_row
    join public.customers customer_row on customer_row.id = order_row.customer_id
   where order_row.id = target_order
     and customer_row.user_id = (select auth.uid())
     and order_row.fulfillment_type = 'curbside'
     and order_row.status in ('paid', 'in_progress', 'ready');
  if not found then raise exception 'order not found, not curbside, or not arrivable'; end if;
  if existing is not null then return existing; end if;

  update public.orders set arrived_at = now() where id = target_order;
  insert into public.order_events (brand_id, order_id, type, source, snapshot)
  select row_brand, target_order, order_row.status, 'guest',
         jsonb_build_object('arrived_at', order_row.arrived_at)
    from public.orders order_row where order_row.id = target_order;
  return (select order_row.arrived_at from public.orders order_row where order_row.id = target_order);
end $$;
revoke all on function app.mark_order_arrived(uuid) from public, anon, authenticated;

create or replace function public.mark_order_arrived(target_order uuid)
returns timestamptz
language sql security invoker set search_path = ''
as $$ select app.mark_order_arrived(target_order) $$;
revoke execute on function public.mark_order_arrived(uuid) from public, anon;
grant execute on function public.mark_order_arrived(uuid) to authenticated;
