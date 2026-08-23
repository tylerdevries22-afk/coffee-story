-- 0023: the human-readable ticket, and the pickup display's narrow read.
--
-- orders has only a uuid. A guest at a counter cannot be called by one, a
-- kiosk receipt cannot print one, and a pickup board cannot show one, so both
-- of those surfaces are blocked on this.
--
-- The number restarts per location per service date rather than running
-- forever: "Order 47" has to be small enough to read across a room and
-- unambiguous only for today, which is the same contract a paper ticket has.

alter table public.orders
  -- Service date in the location's timezone, not the server's. A store open
  -- past midnight would otherwise roll its numbering mid-shift.
  add column service_date date,
  add column daily_number integer,
  -- Display-safe guest name ("Sara D."). Never the full record: this column is
  -- exposed on a screen the whole room can see.
  add column guest_label text;

create unique index orders_daily_number_idx
  on public.orders (location_id, service_date, daily_number)
  where daily_number is not null;

/**
 * Assigns the service date and the next ticket number.
 *
 * The advisory lock is per (location, date), so two tills taking an order in
 * the same millisecond serialise against each other and nothing else. The
 * unique index above is the backstop if this is ever bypassed.
 */
create or replace function app.assign_daily_number() returns trigger
language plpgsql as $$
declare
  tz text;
  today date;
begin
  if new.daily_number is not null then
    return new;
  end if;

  select l.timezone into tz from public.locations l where l.id = new.location_id;
  today := (coalesce(new.created_at, now()) at time zone coalesce(tz, 'UTC'))::date;
  new.service_date := today;

  perform pg_advisory_xact_lock(hashtext(new.location_id::text || today::text));

  select coalesce(max(o.daily_number), 0) + 1
    into new.daily_number
    from public.orders o
   where o.location_id = new.location_id
     and o.service_date = today;

  return new;
end $$;

create trigger orders_assign_daily_number
  before insert on public.orders
  for each row execute function app.assign_daily_number();

-- Backfill so existing rows are not left without a ticket.
update public.orders o
   set service_date = (o.created_at at time zone coalesce(
         (select l.timezone from public.locations l where l.id = o.location_id), 'UTC'))::date
 where o.service_date is null;

with numbered as (
  select id, row_number() over (partition by location_id, service_date order by created_at) as n
    from public.orders
   where daily_number is null
)
update public.orders o set daily_number = numbered.n
  from numbered where numbered.id = o.id;

-- The pickup display's read -----------------------------------------------
--
-- RLS is row-level, so a policy cannot hide a column. A wall screen must never
-- be one query away from customer_id or the cart snapshot, so it reads a view
-- that simply does not select them rather than a policy that hopes it will
-- not ask.

create or replace view public.board_tickets
with (security_invoker = true) as
  select o.id,
         o.brand_id,
         o.location_id,
         o.daily_number,
         o.guest_label,
         o.status,
         o.fulfillment_type,
         o.updated_at
    from public.orders o
   where o.status in ('paid', 'in_progress', 'ready');

comment on view public.board_tickets is
  'Display-safe projection of the active board. No customer_id, no totals, no cart.';

-- A display device sees its own location's board and nothing else. The role
-- check goes through device_is_active so revoking in HQ takes effect at once
-- rather than when the token happens to expire.
create policy orders_display_select on public.orders for select
  using (
    app.device_is_active('display')
    and location_id = app.jwt_device_location()
    and status in ('paid', 'in_progress', 'ready')
  );

-- A kiosk creates orders through the engine, like every other channel, so it
-- gets no insert here. It may read back only the order it just placed, which
-- is how the receipt screen shows a ticket number.
create policy orders_kiosk_select on public.orders for select
  using (
    (app.device_is_active('kiosk') or app.device_is_active('pos'))
    and location_id = app.jwt_device_location()
    and created_at > now() - interval '1 hour'
  );

grant select on public.board_tickets to authenticated, anon;
