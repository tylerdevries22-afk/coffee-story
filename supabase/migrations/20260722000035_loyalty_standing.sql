-- 0035: the two things a loyalty ladder means, told apart.
--
-- `packages/domain/src/rules.ts` keys the reward ladder on ANNUAL points --
-- `tierForAnnualPoints`, `minimumAnnualPoints` -- and decides the guest's
-- earn rate from it. `loyalty_accounts` stores `points_balance` and
-- `lifetime_points` and nothing else, so no annual figure existed anywhere in
-- the database. Every server-side rung was therefore either uncomputable or a
-- lifetime number wearing an annual name, and 0033's board badge documented
-- itself as the second of those.
--
-- They are two different promises and the product wants both:
--
--   ANNUAL   what you have earned in the trailing twelve months. It can fall.
--            It sets the earn RATE, which is an entitlement -- a benefit a
--            guest holds while they keep earning it.
--   LIFETIME what you have ever earned. It cannot fall. It sets the BADGE on
--            the in-store board, which is recognition -- and taking someone's
--            recognition away in front of a room because they travelled for a
--            quarter is a thing no shop wants to do.
--
-- Neither is derivable from the other, so both are computed here and named
-- separately, and nothing has to guess which one a caller meant.

-- ---------------------------------------------------------------------------
-- The rolling window

/**
 * Net points earned in the trailing twelve months.
 *
 * Computed rather than stored. A stored column would need a job to age points
 * out of it, and a job that does not run leaves a guest holding a tier they
 * stopped qualifying for months ago -- silently, and in the guest's favour,
 * which is the direction nobody audits. `loyalty_events` is append-only and
 * indexed on (account_id, created_at desc), so the window is a range scan over
 * one account's recent rows.
 *
 * 'earn' and 'reverse' only. A redemption spends the balance without unmaking
 * the spend that earned it, and an 'adjust' is a manual correction whose sign
 * the operator chose -- counting either would make the ladder a function of
 * how a guest spends rather than how much they buy.
 */
create or replace function app.annual_points_for(target_account uuid)
returns bigint
language sql stable as $$
  select coalesce(sum(
           case le.type
             when 'earn'    then le.points
             when 'reverse' then -abs(le.points)
             else 0
           end), 0)::bigint
    from public.loyalty_events le
   where le.account_id = target_account
     and le.created_at > now() - interval '12 months'
$$;

-- The window predicate is the whole cost of this function; give it an index
-- that matches, rather than relying on the account-wide one to filter by date.
create index if not exists loyalty_events_earning_window_idx
  on public.loyalty_events (account_id, created_at desc)
  where type in ('earn', 'reverse');

-- ---------------------------------------------------------------------------
-- The read

/**
 * A guest's standing, with both figures named.
 *
 * A view rather than two functions callers must remember to combine, so
 * "annual" and "lifetime" arrive together and a screen cannot quietly show one
 * where it meant the other.
 *
 * Gated like every other projection in this schema: a guest sees their own
 * standing, staff see their own location's guests, an owner sees the brand.
 * `points_balance` is here because it is the guest's own spendable number and
 * the app's rewards screen needs it -- it is NOT on `board_tickets`, which is
 * the surface a whole room can read.
 */
create or replace view public.loyalty_standing
with (security_barrier = true) as
  select la.customer_id,
         la.brand_id,
         la.points_balance,
         la.lifetime_points,
         app.annual_points_for(la.id) as annual_points
    from public.loyalty_accounts la
   where app.is_brand_owner(la.brand_id)
      or exists (
           select 1 from public.customers c
            where c.id = la.customer_id and c.user_id = auth.uid()
         );

-- Owner-or-self, and deliberately not "staff at the location". A standing row
-- carries no location, so `app.at_location` cannot gate it, and inventing a
-- location for a guest by joining their order history would make a loyalty
-- read depend on where they last bought coffee. Staff who need a guest's tier
-- read it through the customer record they are already permitted to see.

grant select on public.loyalty_standing to authenticated;
revoke insert, update, delete on public.loyalty_standing from anon, authenticated;

comment on view public.loyalty_standing is
  'A guest''s loyalty standing with annual and lifetime named separately: '
  'annual sets the earn rate (an entitlement that can fall), lifetime sets the '
  'in-store badge (recognition that cannot). Definer view: never grant write '
  'privileges on it.';
