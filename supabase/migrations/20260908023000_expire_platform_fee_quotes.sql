-- Fee quotes serialize concurrent external payment attempts, but they are not
-- revenue. Bound and release reservations so abandoned or rejected attempts
-- cannot consume a location's monthly volume indefinitely.
alter table public.platform_fee_quotes
  add column expires_at timestamptz not null default (now() + interval '1 hour');

alter table public.orders
  add column square_payment_link_id text;

create unique index orders_square_payment_link_idx
  on public.orders (square_payment_link_id)
  where square_payment_link_id is not null;

create index platform_fee_quotes_active_idx
  on public.platform_fee_quotes (location_id, month_start, expires_at);

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
    select quote.gross_cents
    from public.platform_fee_quotes quote
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
    gross_cents, fee_cents, fee_bps_applied, expires_at
  ) values (
    target.id, target.brand_id, target.location_id, p_month_start, p_month_end,
    p_charge_cents, calculated_fee,
    round(calculated_fee::numeric * 10000 / p_charge_cents)::integer,
    least(p_month_end, pg_catalog.now() + interval '1 hour')
  ) returning fee_cents, fee_bps_applied
    into quoted_fee_cents, quoted_fee_bps_applied;
  return next;
end
$$;

create or replace function public.release_platform_fee_quote(p_order_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  quote public.platform_fee_quotes%rowtype;
begin
  select * into quote from public.platform_fee_quotes where order_id = p_order_id;
  if quote.order_id is null then return false; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'platform-fee:' || quote.location_id::text || ':' || quote.month_start::text, 0
  ));
  delete from public.platform_fee_quotes target
  where target.order_id = p_order_id
    and not exists (
      select 1 from public.platform_fees fee where fee.order_id = p_order_id
    );
  return found;
end
$$;

revoke all on function public.release_platform_fee_quote(uuid)
  from public, anon, authenticated;
grant execute on function public.release_platform_fee_quote(uuid) to service_role;

-- The scheduled worker calls Square first. Only provider confirmation that a
-- hosted page is gone authorizes this function to cancel the order and release
-- its tier reservation. The link id binds that confirmation to the exact
-- provider resource stored when checkout was created.
create or replace function public.expire_square_checkout_quote(
  p_order_id uuid,
  p_payment_link_id text
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  quote public.platform_fee_quotes%rowtype;
  target public.orders%rowtype;
begin
  if p_payment_link_id is null or pg_catalog.btrim(p_payment_link_id) = '' then
    raise exception 'payment link id is required';
  end if;

  select * into quote from public.platform_fee_quotes where order_id = p_order_id;
  if quote.order_id is null or quote.expires_at > pg_catalog.now() then return false; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'platform-fee:' || quote.location_id::text || ':' || quote.month_start::text, 0
  ));
  select * into quote from public.platform_fee_quotes
    where order_id = p_order_id for update;
  select * into target from public.orders where id = p_order_id for update;

  if quote.order_id is null or quote.expires_at > pg_catalog.now()
    or target.id is null or target.square_payment_link_id <> p_payment_link_id
    or target.tender_type <> 'square_link'
    or target.status not in ('created', 'cancelled')
    or exists (select 1 from public.platform_fees fee where fee.order_id = p_order_id)
  then return false; end if;

  if target.status = 'created' then
    insert into public.order_events (brand_id, order_id, type, snapshot, source)
    values (
      target.brand_id, target.id, 'cancelled',
      target.totals || pg_catalog.jsonb_build_object(
        'reason', 'hosted_checkout_expired',
        'square_payment_link_id', p_payment_link_id
      ),
      'job'
    );
  end if;

  update public.orders
    set square_checkout_url = null, square_payment_link_id = null
    where id = p_order_id;
  delete from public.platform_fee_quotes where order_id = p_order_id;
  return found;
end
$$;

revoke all on function public.expire_square_checkout_quote(uuid, text)
  from public, anon, authenticated;
grant execute on function public.expire_square_checkout_quote(uuid, text) to service_role;

select app.register_release('20260908023000', 'expire platform fee quotes');
