-- Serialize arrival checks before reading the timestamp so concurrent retries
-- share the original receipt and append exactly one arrival event.
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
     and order_row.status in ('paid', 'in_progress', 'ready')
   for update of order_row;
  if not found then raise exception 'order not found, not curbside, or not arrivable'; end if;
  if existing is not null then return existing; end if;

  update public.orders set arrived_at = now() where id = target_order;
  insert into public.order_events (brand_id, order_id, type, source, snapshot)
  select row_brand, target_order, order_row.status, 'guest',
         jsonb_build_object('arrived_at', order_row.arrived_at)
    from public.orders order_row where order_row.id = target_order;
  return (select order_row.arrived_at from public.orders order_row where order_row.id = target_order);
end $$;

select app.register_release('20260907211000', 'serialize curbside arrival receipts');
