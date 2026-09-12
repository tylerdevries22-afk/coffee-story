-- Two confirmed defects on the money path.
--
-- (1) Refund attempts were not serialized. `refundOrderPayment` read
-- already-refunded cents with a plain SELECT, computed `refundable`, and
-- only then called Square. Two staff devices, each with its own
-- Idempotency-Key, could both read the same $20 order as unrefunded, both
-- validate a $15 refund, and both call Square -- whose idempotency key is
-- `refund-${requestKey}`, different per request, so it never treats the
-- second as a replay of the first.
--
-- Every other money-mutating RPC here serializes at the database:
-- `claim_platform_fee_quote` takes a per-location+month advisory lock before
-- reading; `process_square_refund` does `SELECT ... FOR UPDATE` on the order
-- inside its own single transaction. The manual refund path did neither.
--
-- LOCKING DESIGN, and why "just lock the read" is not the fix it looks like:
--
-- PostgREST runs every RPC call in its own transaction. A `begin_order_refund`
-- that only took `pg_advisory_xact_lock` + `SELECT ... FOR UPDATE` and
-- returned already-refunded cents would commit -- releasing both locks --
-- the instant it returned, long before the caller calls Square. Two attempts
-- that start close together would both call it, both see
-- already_refunded_cents = 0 (neither has written anything yet), and both
-- still go on to call Square: the lock never overlapped the window that
-- matters. Locking the read serializes the READS, not the ATTEMPTS.
--
-- The alternative that keeps a lock held across the Square call --
-- `pg_advisory_lock` (session-scoped) taken by `begin_order_refund` and
-- released by a second RPC after Square answers -- was rejected. PostgREST
-- does not guarantee that release call lands on the same physical
-- connection that took the lock; its own pool (and any pgbouncer
-- transaction-mode pooling in front of it) can hand two HTTP requests to two
-- different backends. `pg_advisory_unlock` on the wrong session is a silent
-- no-op, so a slow client or a crash between the two calls would leak a lock
-- that blocks every future refund on that order until the original backend
-- happens to disconnect. That failure mode is worse than the race it fixes.
--
-- So `begin_order_refund` does what `claim_platform_fee_quote` already does
-- for the same reason (an external call cannot share a database
-- transaction): it turns the in-flight attempt into a durable, COMMITTED
-- claim the next transaction can see, instead of a lock the next transaction
-- would only wait through. It stamps the order row with
-- (refund_claimed_at, refund_claim_key) inside the same locked transaction
-- that reads it. A concurrent second call blocks on that row's FOR UPDATE
-- until the first commits, then sees the live claim and is refused outright
-- -- before it ever calls Square. `end_order_refund` clears the claim once
-- Square has answered, win or lose; a claim nobody clears (a crashed
-- process) self-expires after two minutes, the same bounded-staleness idiom
-- `square_payment_remediation_outbox.available_at` already uses.
--
-- (2) Nothing checked that the discounted tier is actually lower than the
-- base rate. An admin who swapped fee_bps and fee_bps_tier2 -- on /fees, or
-- at brand provisioning -- made every payment above tier_threshold_cents
-- cost MORE, silently: the opposite of rule 3's volume tiering. Guarded in
-- two places: a table CHECK covering every writer of brands/locations,
-- present and future; and the location-override RPC, which additionally
-- resolves a NULL override against the brand's own rate before comparing,
-- because a location overriding only tier2 while inheriting tier1 is a shape
-- a same-row CHECK on locations alone cannot see.

-- ---------------------------------------------------------------------------
-- (1) Refund claim.

alter table public.orders
  add column if not exists refund_claimed_at timestamptz,
  add column if not exists refund_claim_key text;
alter table public.orders
  add constraint orders_refund_claim_paired
  check ((refund_claimed_at is null) = (refund_claim_key is null));

create or replace function public.begin_order_refund(
  p_order_id uuid,
  p_request_key text
)
returns table (
  brand_id uuid,
  status app.order_status,
  total_cents bigint,
  stored_value_applied_cents bigint,
  square_payment_id text,
  already_refunded_cents bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.orders%rowtype;
  claim_ttl constant interval := interval '2 minutes';
begin
  if p_order_id is null or p_request_key is null or btrim(p_request_key) = '' then
    raise exception using errcode = '22023', message = 'refund_claim_identity_incomplete';
  end if;

  -- Redundant with the FOR UPDATE below for this one row, but matches the
  -- advisory-lock idiom every other fee RPC uses and keeps this function's
  -- serialization independent of the row's own lock semantics.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('order-refund:' || p_order_id::text, 0));

  select * into target from public.orders where id = p_order_id for update;
  if target.id is null then
    return;
  end if;

  -- Self-heal a claim nobody released: a crashed process or a client that
  -- gave up on the response must not jam every future refund on this order.
  if target.refund_claimed_at is not null
    and target.refund_claimed_at <= pg_catalog.now() - claim_ttl then
    target.refund_claimed_at := null;
  end if;

  if target.refund_claimed_at is not null
    and target.refund_claim_key is distinct from p_request_key then
    raise exception using errcode = '22023', message = 'refund_attempt_in_progress';
  end if;

  update public.orders set
    refund_claimed_at = pg_catalog.now(),
    refund_claim_key = p_request_key
  where id = target.id;

  -- Already-refunded cents, deduped by processor refund id the same way
  -- `refundedCentsFrom` (packages/engine/src/refunds.ts) dedupes in
  -- TypeScript: each refund id counted once, at the largest amount any of
  -- its rows (manual or webhook shape) recorded.
  with parsed as (
    select
      coalesce(event.square_refund_id, event.snapshot ->> 'refund_id',
        event.snapshot ->> 'square_refund_id') as refund_key,
      greatest(
        coalesce(event.refund_cents, 0),
        coalesce((event.snapshot ->> 'amount_cents')::bigint, 0),
        coalesce((event.snapshot ->> 'refunded_cents')::bigint, 0)
      ) as amount_cents
    from public.order_events event
    where event.order_id = target.id
  ), deduped as (
    select distinct on (refund_key) refund_key, amount_cents
    from parsed
    where refund_key is not null and amount_cents > 0
    order by refund_key, amount_cents desc
  )
  select coalesce(sum(amount_cents), 0) into already_refunded_cents from deduped;

  brand_id := target.brand_id;
  status := target.status;
  total_cents := target.total_cents;
  stored_value_applied_cents := target.stored_value_applied_cents;
  square_payment_id := target.square_payment_id;
  return next;
end $$;

revoke all on function public.begin_order_refund(uuid, text)
  from public, anon, authenticated;
grant execute on function public.begin_order_refund(uuid, text) to service_role;

create or replace function public.end_order_refund(
  p_order_id uuid,
  p_request_key text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_order_id is null or p_request_key is null then
    return false;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('order-refund:' || p_order_id::text, 0));
  update public.orders set refund_claimed_at = null, refund_claim_key = null
  where id = p_order_id and refund_claim_key = p_request_key;
  return found;
end $$;

revoke all on function public.end_order_refund(uuid, text)
  from public, anon, authenticated;
grant execute on function public.end_order_refund(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- (2) Fee tier ordering.

do $$
begin
  if exists (select 1 from public.brands where fee_bps_tier2 > fee_bps) then
    raise exception using errcode = '23514',
      message = 'existing_brand_fee_terms_require_tier_reconciliation';
  end if;
  if exists (select 1 from public.locations
    where fee_bps is not null and fee_bps_tier2 is not null and fee_bps_tier2 > fee_bps) then
    raise exception using errcode = '23514',
      message = 'existing_location_fee_overrides_require_tier_reconciliation';
  end if;
end $$;

alter table public.brands
  add constraint brands_fee_tier2_not_above_tier1 check (fee_bps_tier2 <= fee_bps);
alter table public.locations
  add constraint locations_fee_tier2_not_above_tier1
  check (fee_bps is null or fee_bps_tier2 is null or fee_bps_tier2 <= fee_bps);

create or replace function public.set_platform_location_fee_overrides(
  p_actor_id uuid,
  p_brand_id uuid,
  p_location_id uuid,
  p_correlation_id uuid,
  p_fee_bps integer,
  p_fee_bps_tier2 integer,
  p_tier_threshold_cents bigint
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  result_id uuid;
  brand_fee_bps integer;
  brand_fee_bps_tier2 integer;
begin
  perform app.require_platform_audit(
    p_actor_id, p_brand_id, p_location_id, 'fees.location.update', p_correlation_id
  );
  if (p_fee_bps is not null and p_fee_bps not between 0 and 9000)
     or (p_fee_bps_tier2 is not null and p_fee_bps_tier2 not between 0 and 9000)
     or (p_tier_threshold_cents is not null and p_tier_threshold_cents < 0) then
    raise exception using errcode = '22023', message = 'invalid_location_fee_terms';
  end if;

  select brand.fee_bps, brand.fee_bps_tier2 into brand_fee_bps, brand_fee_bps_tier2
  from public.brands brand where brand.id = p_brand_id;
  if brand_fee_bps is null then
    raise exception using errcode = '23503', message = 'platform_brand_not_found';
  end if;

  -- NULL means "inherit the brand's rate," and the resolved value is what a
  -- payment actually pays -- comparing the raw, possibly-partial inputs
  -- would miss a location that overrides only the discounted tier while
  -- inheriting the base rate from the brand.
  if coalesce(p_fee_bps_tier2, brand_fee_bps_tier2) > coalesce(p_fee_bps, brand_fee_bps) then
    raise exception using errcode = '22023', message = 'location_fee_tier2_above_tier1';
  end if;

  update public.locations set
    fee_bps = p_fee_bps,
    fee_bps_tier2 = p_fee_bps_tier2,
    tier_threshold_cents = p_tier_threshold_cents
  where id = p_location_id and brand_id = p_brand_id
  returning id into result_id;
  if result_id is null then
    raise exception using errcode = '23503', message = 'platform_location_not_found';
  end if;
  return result_id;
end $$;

revoke all on function public.set_platform_location_fee_overrides(uuid, uuid, uuid, uuid, integer, integer, bigint)
  from public, anon, authenticated;
grant execute on function public.set_platform_location_fee_overrides(uuid, uuid, uuid, uuid, integer, integer, bigint)
  to service_role;

-- ---------------------------------------------------------------------------

create or replace function app.assert_refund_serialization_and_fee_tier_order()
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'orders'
      and column_name = 'refund_claimed_at'
  ) then
    raise exception 'orders.refund_claimed_at is missing';
  end if;
  if has_function_privilege('anon', 'public.begin_order_refund(uuid,text)', 'execute')
    or has_function_privilege('authenticated', 'public.begin_order_refund(uuid,text)', 'execute')
    or not has_function_privilege('service_role', 'public.begin_order_refund(uuid,text)', 'execute') then
    raise exception 'begin_order_refund must be service_role-only';
  end if;
  if has_function_privilege('anon', 'public.end_order_refund(uuid,text)', 'execute')
    or has_function_privilege('authenticated', 'public.end_order_refund(uuid,text)', 'execute')
    or not has_function_privilege('service_role', 'public.end_order_refund(uuid,text)', 'execute') then
    raise exception 'end_order_refund must be service_role-only';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'brands_fee_tier2_not_above_tier1' and conrelid = 'public.brands'::regclass
  ) then
    raise exception 'brands is missing the tier-ordering check';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'locations_fee_tier2_not_above_tier1' and conrelid = 'public.locations'::regclass
  ) then
    raise exception 'locations is missing the tier-ordering check';
  end if;
end $$;

revoke all on function app.assert_refund_serialization_and_fee_tier_order()
  from public, anon, authenticated;
grant execute on function app.assert_refund_serialization_and_fee_tier_order()
  to service_role;

select app.register_release(
  '20260912070000',
  'serialize manual refund attempts through a durable per-order claim; require the discounted fee tier to actually be lower',
  'app.assert_refund_serialization_and_fee_tier_order()'::regprocedure
);
