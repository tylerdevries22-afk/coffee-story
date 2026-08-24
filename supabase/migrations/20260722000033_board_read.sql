-- 0033: what the wall is allowed to know, and what it is allowed to say.
--
-- Three separate problems, one read.
--
-- 1. THE VIEW WAS A CONVENTION, NOT A BOUNDARY. 0023 introduced
--    board_tickets so a screen the whole room can see would never be one
--    query away from customer_id or the cart -- but it shipped as
--    `security_invoker = true` alongside `orders_display_select`, a policy
--    granting a display device SELECT on `orders` itself. 0014 grants every
--    column of every public table to `authenticated`, so the narrow view was
--    advisory: the token on that wall tablet could read totals, notes,
--    square_payment_id and customer_id for every active order at its
--    location, and the tablet sits in a public room where anyone can open
--    devtools and lift it. The policy is dropped here and the view becomes
--    security definer with its own gate, so the projection IS the privilege.
--
-- 2. THE BOARD COULD NOT SAY WHERE AN ORDER CAME FROM. orders.channel has
--    existed since 0005 and no surface ever read it. A guest at the counter
--    watching a number that came in from the app cannot tell it apart from
--    one the till just rang up, which is exactly the thing that makes people
--    ask staff "is that mine?".
--
-- 3. STATUS. A tier is the one loyalty fact that belongs on a wall: it is
--    coarse (a bucket, never a balance), it is the reason to download the
--    app, and it is what a guest is proud of. Points, lifetime totals and
--    money stay out. Because a tier needs loyalty_accounts -- which no
--    display device may read, and must never be able to -- it is computed
--    inside the definer view and only the bucket's slug comes out.
--
-- Tier ladder and whether to show it at all are per-brand config, not
-- columns: a brand that considers spend rank private turns it off, and
-- brand_config already carries every other per-tenant display decision
-- (rule 4). Default is off -- opt in, since this is guest information.

-- The tier bucket -----------------------------------------------------------

/**
 * The coarse loyalty bucket for one order's guest, or null.
 *
 * Null for a walk-up with no account, for a brand that has not opted in, and
 * for a brand whose ladder is empty -- three different reasons the board
 * simply shows a name, which is the correct fallback for all of them.
 *
 * security definer because the caller is a display device, which by design
 * cannot read loyalty_accounts. It leaks nothing beyond the slug: no balance,
 * no lifetime total, no customer id.
 */
create or replace function app.loyalty_tier_for(target_customer uuid, target_brand uuid)
returns text
language sql stable security definer set search_path = public, app as $$
  with ladder as (
    -- Off unless the brand opted in, and only ever a JSON array: a tenant
    -- typo must degrade to "no badge", never raise inside a wall screen's
    -- only query. Same bargain resolveTokens makes with a bad hex code.
    select case
             when coalesce(b.brand_config -> 'board' ->> 'showGuestStatus', 'false') = 'true'
              and jsonb_typeof(b.brand_config -> 'board' -> 'tiers') = 'array'
             then b.brand_config -> 'board' -> 'tiers'
             else '[]'::jsonb
           end as tiers
      from public.brands b
     where b.id = target_brand
  ),
  earned as (
    select la.lifetime_points
      from public.loyalty_accounts la
     where la.customer_id = target_customer
       and la.brand_id = target_brand
  )
  select tier.value ->> 'slug'
    from ladder, earned, jsonb_array_elements(ladder.tiers) as tier
   -- Text-then-cast, because a tenant may write anything here and a failed
   -- cast would take the whole board down rather than one badge.
   where tier.value ->> 'minLifetimePoints' ~ '^[0-9]{1,18}$'
     and coalesce(tier.value ->> 'slug', '') <> ''
     and (tier.value ->> 'minLifetimePoints')::bigint <= earned.lifetime_points
   order by (tier.value ->> 'minLifetimePoints')::bigint desc
   limit 1
$$;

revoke execute on function app.loyalty_tier_for from public, anon;
grant execute on function app.loyalty_tier_for to authenticated, service_role;

-- Who may read a board ------------------------------------------------------

/**
 * Mirrors orders_select (0007) minus its customer clause, plus the display
 * device. Deliberately NOT app.is_brand_staff: that is brand-wide, and staff
 * reach on orders is location-scoped. A view that is broader than the policy
 * it replaces is a privilege escalation wearing a projection.
 */
create or replace function app.can_read_board(target_brand uuid, target_location uuid)
returns boolean
language sql stable as $$
  select (app.device_is_active('display')
            and target_brand = app.jwt_brand_id()
            and target_location = app.jwt_device_location())
      or app.is_brand_owner(target_brand)
      or app.at_location(target_brand, target_location)
$$;

-- The read ------------------------------------------------------------------

-- A display device now has no route to `orders` at all. Dropping this is the
-- point of the migration: with it in place the view below is decoration.
drop policy if exists orders_display_select on public.orders;

drop view if exists public.board_tickets;

/**
 * security definer (the default for a view, stated here because 0023 said the
 * opposite and the difference is the whole security argument) so the tier
 * join can reach loyalty_accounts, with can_read_board() as the only gate.
 *
 * security_barrier so a caller cannot slip a leaky function into a WHERE
 * clause and have it evaluated against rows the gate would have removed.
 */
create view public.board_tickets
with (security_barrier = true) as
  select o.id,
         o.brand_id,
         o.location_id,
         o.daily_number,
         o.guest_label,
         o.status,
         o.fulfillment_type,
         o.channel,
         o.arrived_at,
         app.loyalty_tier_for(o.customer_id, o.brand_id) as loyalty_tier,
         o.updated_at
    from public.orders o
   where o.status in ('paid', 'in_progress', 'ready')
     and app.can_read_board(o.brand_id, o.location_id);

grant select on public.board_tickets to authenticated, anon;

-- The write path 0031 said the next view would reopen, closed on arrival.
--
-- 0014 set `alter default privileges ... grant all on tables to authenticated`,
-- and that reaches views. This one is single-table and mostly bare column
-- references, so Postgres makes it automatically updatable -- and it is a
-- definer view, so a write through it would run as the owner, outside RLS,
-- against `orders`. A display device revoked in HQ ten seconds ago could still
-- have deleted the board it was no longer allowed to read.
--
-- 0031 closed exactly this on brand_storefront and location_square_status and
-- left the instruction for whoever added the next definer view. This is that
-- view; SELECT is the entire point of it and the writes go.
revoke insert, update, delete on public.board_tickets from anon, authenticated;

comment on view public.board_tickets is
  'Display-safe projection of the active board, gated by app.can_read_board. '
  'No customer_id, no totals, no cart, no points -- only a coarse tier slug. '
  'Definer view: never grant write privileges on it.';
