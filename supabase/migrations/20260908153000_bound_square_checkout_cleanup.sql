-- Lease a finite, fair batch before calling Square. A provider outage must not
-- keep the shared five-minute cron inside one cleanup loop until Vercel kills
-- the route, and a failed low-order UUID must not pin everything behind it.
alter table public.platform_fee_quotes
  add column cleanup_claimed_at timestamptz;

create index platform_fee_quotes_cleanup_queue_idx
  on public.platform_fee_quotes (
    cleanup_claimed_at asc nulls first,
    expires_at asc,
    order_id asc
  );

create or replace function public.claim_due_square_checkout_quotes(
  p_now timestamptz,
  p_limit integer default 50
)
returns table (
  order_id uuid,
  brand_id uuid,
  location_id uuid,
  expires_at timestamptz
)
language plpgsql security definer set search_path = '' as $$
begin
  if p_now is null or p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception 'invalid Square checkout cleanup claim inputs';
  end if;

  return query
  with due as materialized (
    select quote.order_id
    from public.platform_fee_quotes quote
    join public.orders target on target.id = quote.order_id
    where quote.expires_at <= p_now
      and target.tender_type = 'square_link'
      and target.status in ('created', 'cancelled')
      and target.square_payment_link_id is not null
      and target.square_order_id is not null
      and (
        quote.cleanup_claimed_at is null
        or quote.cleanup_claimed_at <= p_now - interval '5 minutes'
      )
    order by quote.cleanup_claimed_at asc nulls first,
      quote.expires_at asc,
      quote.order_id asc
    for update of quote skip locked
    limit p_limit
  ), claimed as (
    update public.platform_fee_quotes quote
    set cleanup_claimed_at = p_now
    from due
    where quote.order_id = due.order_id
    returning quote.order_id, quote.brand_id, quote.location_id, quote.expires_at
  )
  select claimed.order_id, claimed.brand_id, claimed.location_id, claimed.expires_at
  from claimed;
end
$$;

revoke all on function public.claim_due_square_checkout_quotes(timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.claim_due_square_checkout_quotes(timestamptz, integer)
  to service_role;

select app.register_release('20260908153000', 'bound Square checkout cleanup');
