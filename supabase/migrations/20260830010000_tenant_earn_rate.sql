-- The earn rate is tenant data, and was not reaching the ledger.
--
-- 20260722000035 wrote down what the two loyalty figures mean, in its own
-- words: annual points set "the earn RATE, which is an entitlement". Nothing
-- ever read them for that. `app.apply_order_event_side_effects` credited
-- `target.subtotal_cents / 10` -- ten points per dollar, for every guest, at
-- every brand on the platform, whatever ladder that brand published.
--
-- So a guest is shown one number and credited another. `pointsForPurchase` in
-- packages/domain reads the rung the guest is standing on, and the customer app
-- promises the result of it on the bag step, the order screen, the gift screen
-- and both rewards tabs. On Coffee Story's published ladder a Daily Ritual
-- regular is told 11 points per dollar and paid 10; a Coffee Legend is told 13.
-- The guest sees the shortfall in their balance and the shop cannot explain it,
-- because nothing in the product knows the two disagree.
--
-- It is also the franchise defect in its plainest form: the rate was a constant
-- in a migration, so a second brand's ladder was decoration. The board badge
-- already reads its ladder out of `brand_config` (20260722000033's
-- `app.loyalty_tier_for`); this reads the earn ladder the same way, with the
-- same bargain -- a tenant typo degrades rather than raising inside a payment.

-- ---------------------------------------------------------------------------
-- The rate

/**
 * Points per dollar for one guest at one brand, from the brand's own ladder.
 *
 * Mirrors `rewardTiersFrom` and `tierForAnnualPoints` in
 * `packages/domain/src/rules.ts`, down to the three rules that decide whether a
 * published ladder is used at all:
 *
 *   - every rung must parse -- a name, a whole non-negative
 *     `minimumAnnualPoints`, a positive `pointsPerDollar`;
 *   - some rung must sit at zero, or a new guest stands on no rung;
 *   - an absent or empty `tiers` is the same as an unusable one.
 *
 * A ladder failing any of them is ignored whole rather than half-applied,
 * because every rung of it is money: half a ladder pays some guests a rate
 * their shop never published. What is left is the generic four-rung ladder the
 * tenant template promises a shop inherits by leaving `tiers` empty -- the
 * second half of a rule written in two languages, which
 * `tests/consistency/src/one-rule-two-languages.test.ts` compares against
 * `REWARD_TIERS` so the two cannot drift.
 *
 * Every cast sits inside a `case` that has already matched the text against a
 * pattern, rather than beside it in a `where`: `and` does not promise to
 * evaluate left to right, and a cast that raised here would raise inside the
 * payment that triggered it.
 */
create or replace function app.loyalty_earn_rate_for(target_account uuid, target_brand uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  with published as (
    select case
             when jsonb_typeof(b.brand_config -> 'loyalty' -> 'tiers') = 'array'
             then b.brand_config -> 'loyalty' -> 'tiers'
             else '[]'::jsonb
           end as tiers
      from public.brands b
     where b.id = target_brand
  ),
  rungs as (
    select
      case when jsonb_typeof(tier.value) = 'object'
            and coalesce(tier.value ->> 'minimumAnnualPoints', '') ~ '^[0-9]{1,15}$'
           then (tier.value ->> 'minimumAnnualPoints')::bigint
      end as minimum,
      -- Bounded digits on both sides of the point: a tenant numeral long
      -- enough to overflow the cast costs the ladder, not the order.
      case when jsonb_typeof(tier.value) = 'object'
            and coalesce(tier.value ->> 'pointsPerDollar', '') ~ '^[0-9]{1,6}([.][0-9]{1,4})?$'
           then (tier.value ->> 'pointsPerDollar')::numeric
      end as rate,
      case when jsonb_typeof(tier.value) = 'object'
           then coalesce(btrim(tier.value ->> 'name'), '')
      end as name
      from published, jsonb_array_elements(published.tiers) as tier
  ),
  -- Over an empty ladder `bool_and` is null, which fails the guard below and
  -- takes the generic ladder -- the same answer a malformed one gets, and the
  -- same answer `rewardTiersFrom` gives for `[]`.
  usable as (
    select bool_and(minimum is not null and rate is not null and rate > 0 and name <> '') as whole,
           bool_or(minimum = 0 and rate is not null and rate > 0 and name <> '') as grounded
      from rungs
  ),
  -- Clamped, because a guest whose reversals outweigh a thin trailing year has
  -- negative annual points and belongs on the ground rung, not off the ladder.
  -- `tierForAnnualPoints` clamps the same way.
  standing as (
    select greatest(app.annual_points_for(target_account), 0) as annual_points
  )
  select coalesce(
    (select r.rate
       from rungs r, usable u, standing s
      where u.whole and u.grounded and r.minimum <= s.annual_points
      order by r.minimum desc
      limit 1),
    -- The generic ladder, mirroring REWARD_TIERS.
    (select g.rate
       from (values (0::bigint, 10::numeric), (500, 11), (1500, 12), (2500, 13)) as g (minimum, rate),
            standing s
      where g.minimum <= s.annual_points
      order by g.minimum desc
      limit 1));
$$;

comment on function app.loyalty_earn_rate_for(uuid, uuid) is
  'Points per dollar from brand_config.loyalty.tiers, keyed on trailing-year points. '
  'Mirrors packages/domain/src/rules.ts; a ladder that does not parse whole, or does '
  'not reach zero, is ignored in favour of the generic ladder a tenant inherits by '
  'leaving tiers empty.';

-- Called only by the definer trigger below, which owns it. A trigger needs no
-- caller EXECUTE, and neither does its helper.
revoke all on function app.loyalty_earn_rate_for(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The earn

-- Rewritten only in its earn branch: the brand check, the guest check and both
-- reversal branches are 20260824110100's, unchanged. `loyalty_record_earn`
-- still takes the points rather than the rate, so the arithmetic stays on this
-- side of the call and that function keeps its own idempotency.
create or replace function app.apply_order_event_side_effects()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.orders%rowtype;
  earning_account uuid;
begin
  if new.square_refund_id is null and new.type not in ('paid', 'cancelled') then return new; end if;
  select candidate.* into target
    from public.orders candidate
   where candidate.id = new.order_id
     and candidate.brand_id = new.brand_id;
  if not found then
    raise exception 'order event brand does not match its order';
  end if;
  if target.customer_id is null then return new; end if;

  if new.square_refund_id is not null then
    perform public.loyalty_reverse_earn(
      target.brand_id, target.customer_id, target.id,
      target.total_cents, new.refund_cents,
      'square_refund:' || new.square_refund_id
    );
  elsif new.type = 'paid' then
    -- Keyed on customer alone, the way `loyalty_record_earn` resolves the same
    -- account: `loyalty_accounts` is unique on customer_id, so adding brand_id
    -- here would find nothing for a guest whose account was opened elsewhere
    -- and quietly drop them to the ground rung. A guest with no account yet
    -- resolves to null, which has no annual points -- the ground rung, and the
    -- same answer `tierForAnnualPoints` gives a new guest in the app.
    select la.id into earning_account
      from public.loyalty_accounts la
     where la.customer_id = target.customer_id;
    -- The rung is read before this order's points land, so an order cannot
    -- promote the guest and then pay itself at the new rate.
    perform public.loyalty_record_earn(
      target.brand_id, target.customer_id, target.id,
      floor((target.subtotal_cents / 100.0)
            * app.loyalty_earn_rate_for(earning_account, target.brand_id))::bigint
    );
  else
    perform public.loyalty_reverse_earn(
      target.brand_id, target.customer_id, target.id,
      target.total_cents, target.total_cents, 'cancel:' || target.id::text
    );
  end if;
  return new;
end $$;

-- Same name, same timing; recreated so a replay onto a database that never saw
-- the earlier version still ends up wired.
drop trigger if exists order_events_side_effects on public.order_events;
create trigger order_events_side_effects
  after insert on public.order_events
  for each row execute function app.apply_order_event_side_effects();

revoke all on function app.apply_order_event_side_effects() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Readiness link
--
-- verify.yml derives the expected readiness from the newest migration
-- filename, so every migration extends the chain or the release gate fails
-- closed.
--
-- What this link asserts is the defect it repaired, and the one way it can
-- come back: a `create or replace` of the trigger function that reinstates a
-- constant rate. Shape, not text -- the earn branch may be rewritten freely as
-- long as it still asks the brand for the rate. The third check is the quieter
-- failure: `create or replace function` leaves triggers alone, but this
-- migration drops and recreates one, and a database that ends up with the
-- function and no trigger earns nobody anything with no error anywhere.

alter function public.platform_release_readiness()
  rename to platform_release_readiness_20260830002000;
alter function public.platform_release_readiness_20260830002000() set schema app;
revoke all on function app.platform_release_readiness_20260830002000()
  from public, anon, authenticated;
grant execute on function app.platform_release_readiness_20260830002000()
  to service_role;

create or replace function public.platform_release_readiness()
returns text language plpgsql stable security invoker set search_path = '' as $$
declare earn_source text;
begin
  if app.platform_release_readiness_20260830002000() <> '20260830002000' then
    raise exception 'claim helper readiness prerequisite is incomplete';
  end if;

  if not exists (
    select 1
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app'
       and p.proname = 'loyalty_earn_rate_for'
       and p.pronargs = 2
       and 'search_path=""' = any(p.proconfig)
  ) then
    raise exception 'the tenant earn rate helper is missing or lost its pinned search_path';
  end if;

  select p.prosrc into earn_source
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'apply_order_event_side_effects';
  if earn_source is null or earn_source !~ 'loyalty_earn_rate_for' then
    raise exception 'the loyalty earn path does not read the brand ladder';
  end if;
  -- `\M` is end-of-word: this catches `subtotal_cents / 10`, the constant that
  -- was here, without catching `subtotal_cents / 100.0`, which is the cents-to-
  -- dollars conversion the rate is then multiplied by.
  if earn_source ~ 'subtotal_cents\s*/\s*10\M' then
    raise exception 'the loyalty earn path divides by a constant rate again';
  end if;
  if earn_source !~ 'subtotal_cents\s*/\s*100' then
    raise exception 'the loyalty earn path no longer converts cents to dollars';
  end if;

  if not exists (
    select 1
      from pg_catalog.pg_trigger t
      join pg_catalog.pg_class c on c.oid = t.tgrelid
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = 'order_events'
       and t.tgname = 'order_events_side_effects'
       and not t.tgisinternal
  ) then
    raise exception 'order_events has no side-effect trigger, so no order earns anything';
  end if;

  return '20260830010000';
end $$;
revoke all on function public.platform_release_readiness()
  from public, anon, authenticated;
grant execute on function public.platform_release_readiness()
  to service_role;
