-- 0034: finish what 0031 started, and take the kiosk off `orders`.
--
-- 0031 closed the definer-view write path on the two views that had it, and
-- left a comment telling whoever added the next one to do the same. 0033 was
-- that next one and did. A comment is not a control, though: it worked twice
-- because two people happened to read it, and the third will be whoever is in
-- a hurry. `packages/schema/src/surfaces.test.ts` now asserts the invariant
-- over every view in the tree, and this migration makes the tree satisfy it.

-- ---------------------------------------------------------------------------
-- 1. The metrics views still carried write grants.
--
-- Inert today: all three are aggregates, and Postgres refuses INSERT, UPDATE
-- and DELETE on a view that is not automatically updatable, so the privilege
-- has never been reachable. It is a trap rather than a hole -- the day someone
-- simplifies one of these into a plain projection, or hangs an INSTEAD OF
-- trigger on it, the grant is already there and nothing says so.
--
-- Executed before this ran: `information_schema.role_table_grants` listed
-- INSERT, UPDATE and DELETE for both anon and authenticated on all three.
revoke insert, update, delete on public.brand_daily_metrics from anon, authenticated;
revoke insert, update, delete on public.location_daily_metrics from anon, authenticated;
revoke insert, update, delete on public.drop_performance from anon, authenticated;

comment on view public.brand_daily_metrics is
  'Read-only aggregate. Never grant write privileges on a view.';
comment on view public.location_daily_metrics is
  'Read-only aggregate. Never grant write privileges on a view.';
comment on view public.drop_performance is
  'Read-only aggregate. Never grant write privileges on a view.';

-- ---------------------------------------------------------------------------
-- 2. A lobby kiosk could read every order at its location.
--
-- `orders_kiosk_select` (0023) exists so a receipt screen can show the ticket
-- number of the order just placed. What it actually grants is SELECT on
-- `orders` -- every column, every row at that location, for a rolling hour.
-- 0014 grants all columns to `authenticated`, so that is `customer_id`,
-- `totals`, `note`, `square_payment_id` and the rest, for strangers' orders,
-- held by a tablet bolted to a counter in a public room. Same shape as the
-- display policy 0033 dropped, on a surface just as reachable: anyone who can
-- open devtools on that kiosk can read the shop's morning.
--
-- The narrow projection is the privilege here too. A receipt needs a number
-- and a name; it does not need a cart.
drop policy if exists orders_kiosk_select on public.orders;

/**
 * What the ordering device may read back, and for how long.
 *
 * Scoped to the device's own location and a short window rather than to "the
 * order you just placed", because the kiosk does not authenticate a guest and
 * so cannot prove which order is its own. The window is the containment: a
 * receipt is read seconds after checkout, and ten minutes is already generous.
 * 0023 allowed an hour, which is a whole breakfast service.
 */
create or replace function app.can_read_receipt(target_brand uuid, target_location uuid)
returns boolean
language sql stable as $$
  select (app.device_is_active('kiosk') or app.device_is_active('pos'))
     and target_brand = app.jwt_brand_id()
     and target_location = app.jwt_device_location()
$$;

create or replace view public.kiosk_receipts
with (security_barrier = true) as
  select o.id,
         o.brand_id,
         o.location_id,
         o.daily_number,
         o.guest_label,
         o.status,
         o.fulfillment_type,
         o.created_at
    from public.orders o
   where o.created_at > now() - interval '10 minutes'
     and app.can_read_receipt(o.brand_id, o.location_id);

grant select on public.kiosk_receipts to authenticated, anon;
revoke insert, update, delete on public.kiosk_receipts from anon, authenticated;

comment on view public.kiosk_receipts is
  'Ticket number and display name for an order just placed, gated by '
  'app.can_read_receipt. No customer_id, no totals, no cart. '
  'Definer view: never grant write privileges on it.';
