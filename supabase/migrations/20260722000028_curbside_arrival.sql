-- 0028: "I'm here".
--
-- fulfillment_type has carried 'curbside' since 0001, but nothing ever told
-- the shop the guest had arrived -- so the one thing curbside needs to work
-- was missing, and a car could sit outside a counter that had no idea.
--
-- Arrival is deliberately NOT a status transition. A curbside order can be
-- arrived-at while it is still in_progress, and rule 2's machine has no edge
-- for that; forcing one would mean either a bogus state or a transition that
-- can fire twice. It is a timestamp plus an event, and the board renders it as
-- a badge on a ticket that is otherwise wherever it already was.

alter table public.orders
  add column arrived_at timestamptz;

create index orders_arrived_idx on public.orders (location_id, arrived_at)
  where arrived_at is not null;

-- order_events.source gains 'guest' so an arrival is attributable without
-- pretending a customer performed an operator transition.
alter table public.order_events drop constraint if exists order_events_source_check;
alter table public.order_events
  add constraint order_events_source_check
  check (source in ('system', 'customer', 'guest', 'operator', 'webhook', 'job'));

/**
 * A guest marks their own order arrived, once.
 *
 * A policy cannot express "only this column", so the write goes through a
 * function: it checks the caller owns the order, that the order is actually
 * curbside, and that it is in a state where arriving means anything. Calling
 * it twice is a no-op rather than an error -- a guest who taps again from a
 * flaky connection should not see a failure.
 */
create or replace function public.mark_order_arrived(target_order uuid)
returns timestamptz
language plpgsql security definer set search_path = public, app as $$
declare
  existing timestamptz;
  row_brand uuid;
begin
  select o.arrived_at, o.brand_id into existing, row_brand
    from public.orders o
    join public.customers c on c.id = o.customer_id
   where o.id = target_order
     and c.user_id = auth.uid()
     and o.fulfillment_type = 'curbside'
     and o.status in ('paid', 'in_progress', 'ready');

  if not found then
    raise exception 'order not found, not curbside, or not arrivable';
  end if;

  if existing is not null then
    return existing;
  end if;

  update public.orders set arrived_at = now() where id = target_order;

  insert into public.order_events (brand_id, order_id, type, source, snapshot)
  select row_brand, target_order, o.status, 'guest',
         jsonb_build_object('arrived_at', o.arrived_at)
    from public.orders o where o.id = target_order;

  return (select o.arrived_at from public.orders o where o.id = target_order);
end $$;

revoke execute on function public.mark_order_arrived from anon;
grant execute on function public.mark_order_arrived to authenticated;

-- The board view carries arrival so a display can badge it without a join.
--
-- Appended after updated_at, not inserted before it. CREATE OR REPLACE VIEW
-- may only ADD columns to the end: inserting one mid-list reads to Postgres as
-- renaming every column after it, and 0023 already ended this view on
-- updated_at. That failed as
--
--   cannot change name of view column "updated_at" to "arrived_at"
--
-- the first time these migrations were actually run, which is the difference
-- between SQL that parses and SQL that applies.
create or replace view public.board_tickets
with (security_invoker = true) as
  select o.id,
         o.brand_id,
         o.location_id,
         o.daily_number,
         o.guest_label,
         o.status,
         o.fulfillment_type,
         o.updated_at,
         o.arrived_at
    from public.orders o
   where o.status in ('paid', 'in_progress', 'ready');

grant select on public.board_tickets to authenticated, anon;
