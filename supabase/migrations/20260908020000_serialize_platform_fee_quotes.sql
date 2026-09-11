-- Reserve each order's platform fee under one location-month lock. External
-- Square calls cannot share a database transaction, so the durable quote is
-- the serialization point that stops concurrent checkouts taking the same
-- remaining cents below a volume threshold.
create table public.platform_fee_quotes (
  order_id uuid primary key references public.orders (id) on delete cascade,
  brand_id uuid not null references public.brands (id) on delete cascade,
  location_id uuid not null references public.locations (id) on delete cascade,
  month_start timestamptz not null,
  month_end timestamptz not null,
  gross_cents bigint not null check (gross_cents > 0),
  fee_cents bigint not null check (fee_cents >= 0 and fee_cents <= gross_cents),
  fee_bps_applied integer not null check (fee_bps_applied between 0 and 10000),
  created_at timestamptz not null default now(),
  check (month_end > month_start)
);

create index platform_fee_quotes_location_month_idx
  on public.platform_fee_quotes (location_id, month_start);
create index platform_fee_quotes_brand_idx on public.platform_fee_quotes (brand_id);

alter table public.platform_fee_quotes enable row level security;
revoke all on table public.platform_fee_quotes from public, anon, authenticated;

create or replace function public.claim_platform_fee_quote(
  p_order_id uuid,
  p_location_id uuid,
  p_charge_cents bigint,
  p_fee_bps integer,
  p_fee_bps_tier2 integer,
  p_tier_threshold_cents bigint,
  p_month_start timestamptz,
  p_month_end timestamptz
)
returns table (quoted_fee_cents bigint, quoted_fee_bps_applied integer)
language plpgsql security definer set search_path = '' as $$
declare
  target public.orders%rowtype;
  existing public.platform_fee_quotes%rowtype;
  month_gross bigint;
  below_cents bigint;
  calculated_fee bigint;
begin
  if p_charge_cents <= 0 or p_fee_bps not between 0 and 10000
    or p_fee_bps_tier2 not between 0 and 10000
    or p_tier_threshold_cents < 0 or p_month_end <= p_month_start then
    raise exception 'invalid platform fee quote inputs';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'platform-fee:' || p_location_id::text || ':' || p_month_start::text, 0
  ));

  select * into target from public.orders where id = p_order_id for update;
  if target.id is null or target.location_id <> p_location_id
    or target.total_cents - target.stored_value_applied_cents <> p_charge_cents then
    raise exception 'order does not match platform fee quote';
  end if;

  select * into existing from public.platform_fee_quotes where order_id = p_order_id;
  if existing.order_id is not null then
    if existing.month_start <> p_month_start or existing.month_end <> p_month_end
      or existing.gross_cents <> p_charge_cents then
      raise exception 'existing platform fee quote does not match request';
    end if;
    return query select existing.fee_cents, existing.fee_bps_applied;
    return;
  end if;

  select coalesce(sum(volume.gross_cents), 0)::bigint into month_gross
  from (
    select fee.gross_cents from public.platform_fees fee
    where fee.location_id = p_location_id
      and fee.created_at >= p_month_start and fee.created_at < p_month_end
    union all
    select quote.gross_cents from public.platform_fee_quotes quote
    where quote.location_id = p_location_id and quote.month_start = p_month_start
      and not exists (
        select 1 from public.platform_fees fee where fee.order_id = quote.order_id
      )
  ) volume;

  below_cents := least(p_charge_cents,
    greatest(0::bigint, p_tier_threshold_cents - month_gross));
  calculated_fee := round((
    below_cents::numeric * p_fee_bps
    + (p_charge_cents - below_cents)::numeric * p_fee_bps_tier2
  ) / 10000)::bigint;

  insert into public.platform_fee_quotes (
    order_id, brand_id, location_id, month_start, month_end,
    gross_cents, fee_cents, fee_bps_applied
  ) values (
    target.id, target.brand_id, target.location_id, p_month_start, p_month_end,
    p_charge_cents, calculated_fee,
    round(calculated_fee::numeric * 10000 / p_charge_cents)::integer
  ) returning fee_cents, fee_bps_applied
    into quoted_fee_cents, quoted_fee_bps_applied;
  return next;
end
$$;

revoke all on function public.claim_platform_fee_quote(
  uuid, uuid, bigint, integer, integer, bigint, timestamptz, timestamptz
) from public, anon, authenticated;
grant execute on function public.claim_platform_fee_quote(
  uuid, uuid, bigint, integer, integer, bigint, timestamptz, timestamptz
) to service_role;

select app.register_release('20260908020000', 'serialize platform fee quotes');
