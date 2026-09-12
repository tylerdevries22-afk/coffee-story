-- The platform kept its fee when a franchisee refunded a customer.
--
-- refundSquarePayment sent Square no `app_fee_money`, which Square reads as
-- "the developer contributes nothing": the seller funds the whole refund and
-- the platform keeps its cut of a sale that no longer happened. Nothing in the
-- database recorded that either -- the only platform_fees reference on any
-- refund path was an index.
--
-- A column rather than a reversing row. platform_fees has
-- `fee_cents >= 0` and `square_payment_id ... unique`, so a negative row is
-- rejected by the check and a second row for the same payment by the index.
-- Accumulating what has been returned keeps one row per payment, which is what
-- every existing reader and the month-to-date tiering query already assume.

alter table public.platform_fees
  add column if not exists refunded_fee_cents bigint not null default 0;

-- Never more than was charged: a sequence of partial refunds must not give back
-- more fee than the sale produced.
alter table public.platform_fees
  drop constraint if exists platform_fees_refunded_within_charged;
alter table public.platform_fees
  add constraint platform_fees_refunded_within_charged
  check (refunded_fee_cents >= 0 and refunded_fee_cents <= fee_cents);

/**
 * Record the platform's share of a refund against the paying order.
 *
 * Returns the amount actually recorded, which is the requested amount clamped
 * to what is left unreturned. Clamping here rather than raising keeps a
 * duplicate webhook delivery idempotent-ish: replaying a refund cannot push the
 * total past the fee, and the caller learns what was really booked.
 */
create or replace function public.record_platform_fee_refund(
  p_order_id uuid,
  p_refund_fee_cents bigint
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  fee public.platform_fees%rowtype;
  recordable bigint;
begin
  if p_refund_fee_cents is null or p_refund_fee_cents <= 0 then
    return 0;
  end if;
  select * into fee from public.platform_fees
    where order_id = p_order_id for update;
  if not found then
    -- An order with no fee row was never charged an application fee. There is
    -- nothing to give back, and that is not an error.
    return 0;
  end if;
  recordable := least(p_refund_fee_cents, fee.fee_cents - fee.refunded_fee_cents);
  if recordable <= 0 then
    return 0;
  end if;
  update public.platform_fees
    set refunded_fee_cents = refunded_fee_cents + recordable
    where id = fee.id;
  return recordable;
end $$;

revoke all on function public.record_platform_fee_refund(uuid, bigint)
  from public, anon, authenticated, service_role;
grant execute on function public.record_platform_fee_refund(uuid, bigint)
  to service_role;

create or replace function app.assert_platform_fee_refunds_recordable()
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'platform_fees'
      and column_name = 'refunded_fee_cents' and is_nullable = 'NO'
  ) then
    raise exception 'platform_fees.refunded_fee_cents is missing';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'platform_fees_refunded_within_charged'
      and conrelid = 'public.platform_fees'::regclass
  ) then
    raise exception 'the refunded-within-charged cap on platform_fees is missing';
  end if;
  -- The recorder moves money-shaped numbers and must never be client callable.
  if has_function_privilege('anon', 'public.record_platform_fee_refund(uuid,bigint)', 'execute')
    or has_function_privilege('authenticated', 'public.record_platform_fee_refund(uuid,bigint)', 'execute') then
    raise exception 'record_platform_fee_refund is client reachable';
  end if;
end $$;

revoke all on function app.assert_platform_fee_refunds_recordable()
  from public, anon, authenticated;
grant execute on function app.assert_platform_fee_refunds_recordable() to service_role;

select app.register_release(
  '20260912020000',
  'refunds return the platform fee in proportion and record it',
  'app.assert_platform_fee_refunds_recordable()'::regprocedure
);
