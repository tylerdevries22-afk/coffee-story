-- Keep quote retries live without allowing a delayed release to delete a newer
-- reservation, and reject NULL batch limits before they become LIMIT ALL.
alter table public.platform_fee_quotes
  add column claim_generation uuid not null default gen_random_uuid();

drop function public.claim_platform_fee_quote(
  uuid, uuid, bigint, integer, integer, bigint, timestamptz, timestamptz
);

create function public.claim_platform_fee_quote(
  p_order_id uuid,
  p_location_id uuid,
  p_charge_cents bigint,
  p_fee_bps integer,
  p_fee_bps_tier2 integer,
  p_tier_threshold_cents bigint,
  p_month_start timestamptz,
  p_month_end timestamptz,
  p_require_existing boolean default false
)
returns table (
  quoted_fee_cents bigint,
  quoted_fee_bps_applied integer,
  quote_claim_generation uuid
)
language plpgsql security definer set search_path = '' as $$
declare
  order_row public.orders%rowtype;
  existing public.platform_fee_quotes%rowtype;
  month_gross bigint;
  below_cents bigint;
  calculated_fee bigint;
begin
  if p_order_id is null or p_location_id is null or p_charge_cents is null
    or p_fee_bps is null or p_fee_bps_tier2 is null
    or p_tier_threshold_cents is null or p_month_start is null or p_month_end is null
    or p_require_existing is null
    or p_charge_cents <= 0 or p_fee_bps not between 0 and 10000
    or p_fee_bps_tier2 not between 0 and 10000
    or p_tier_threshold_cents < 0 or p_month_end <= p_month_start then
    raise exception 'invalid platform fee quote inputs';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'platform-fee:' || p_location_id::text || ':' || p_month_start::text, 0
  ));
  select * into order_row from public.orders where id = p_order_id for update;
  if order_row.id is null or order_row.status <> 'created'
    or order_row.location_id is distinct from p_location_id
    or order_row.total_cents - order_row.stored_value_applied_cents is distinct from p_charge_cents then
    raise exception 'order does not match platform fee quote';
  end if;
  select * into existing from public.platform_fee_quotes
  where order_id = p_order_id for update;
  if existing.order_id is not null then
    if existing.location_id is distinct from p_location_id
      or existing.month_start is distinct from p_month_start
      or existing.month_end is distinct from p_month_end
      or existing.gross_cents is distinct from p_charge_cents
      or existing.cleanup_claimed_at is not null
      or exists (select 1 from public.platform_fees fee where fee.order_id = p_order_id) then
      raise exception 'existing platform fee quote does not match request';
    end if;
    update public.platform_fee_quotes quote set
      expires_at = least(p_month_end, pg_catalog.now() + interval '1 hour'),
      claim_generation = gen_random_uuid()
    where quote.order_id = p_order_id
    returning quote.fee_cents, quote.fee_bps_applied, quote.claim_generation
      into quoted_fee_cents, quoted_fee_bps_applied, quote_claim_generation;
    return next;
    return;
  end if;
  if p_require_existing then
    raise exception 'existing platform fee quote is required';
  end if;
  select coalesce(sum(volume.gross_cents), 0)::bigint into month_gross
  from (
    select fee.gross_cents from public.platform_fees fee
    where fee.location_id = p_location_id
      and fee.created_at >= p_month_start and fee.created_at < p_month_end
    union all
    select quote.gross_cents from public.platform_fee_quotes quote
    where quote.location_id = p_location_id and quote.month_start = p_month_start
      and not exists (select 1 from public.platform_fees fee where fee.order_id = quote.order_id)
  ) volume;
  below_cents := least(p_charge_cents,
    greatest(0::bigint, p_tier_threshold_cents - month_gross));
  calculated_fee := round((below_cents::numeric * p_fee_bps
    + (p_charge_cents - below_cents)::numeric * p_fee_bps_tier2) / 10000)::bigint;
  insert into public.platform_fee_quotes (
    order_id, brand_id, location_id, month_start, month_end,
    gross_cents, fee_cents, fee_bps_applied, expires_at
  ) values (
    order_row.id, order_row.brand_id, order_row.location_id, p_month_start, p_month_end,
    p_charge_cents, calculated_fee,
    round(calculated_fee::numeric * 10000 / p_charge_cents)::integer,
    least(p_month_end, pg_catalog.now() + interval '1 hour')
  ) returning fee_cents, fee_bps_applied, claim_generation
    into quoted_fee_cents, quoted_fee_bps_applied, quote_claim_generation;
  return next;
end $$;

drop function public.release_platform_fee_quote(uuid);

create function public.release_platform_fee_quote(
  p_order_id uuid,
  p_claim_generation uuid
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  quote public.platform_fee_quotes%rowtype;
  order_row public.orders%rowtype;
begin
  if p_order_id is null or p_claim_generation is null then return false; end if;
  select * into quote from public.platform_fee_quotes where order_id = p_order_id;
  if quote.order_id is null then return false; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'platform-fee:' || quote.location_id::text || ':' || quote.month_start::text, 0
  ));
  select * into order_row from public.orders where id = p_order_id for update;
  select * into quote from public.platform_fee_quotes where order_id = p_order_id for update;
  delete from public.platform_fee_quotes candidate
  where candidate.order_id = p_order_id
    and candidate.claim_generation = p_claim_generation
    and quote.order_id is not null
    and quote.cleanup_claimed_at is null
    and order_row.id is not null
    and order_row.square_checkout_url is null
    and order_row.square_payment_link_id is null
    and order_row.square_payment_id is null
    and not exists (select 1 from public.platform_fees fee where fee.order_id = p_order_id);
  return found;
end $$;

create function public.bind_square_checkout_link(
  p_order_id uuid,
  p_claim_generation uuid,
  p_checkout_url text,
  p_payment_link_id text,
  p_square_order_id text
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  quote public.platform_fee_quotes%rowtype;
  target public.orders%rowtype;
begin
  if p_order_id is null or p_claim_generation is null
    or p_checkout_url is null or p_payment_link_id is null
    or p_checkout_url !~ '^https://[^[:space:]]{3,2048}$'
    or length(p_payment_link_id) not between 3 and 255
    or p_payment_link_id ~ '[[:space:]]'
    or (p_square_order_id is not null and (
      length(p_square_order_id) not between 3 and 255 or p_square_order_id ~ '[[:space:]]'
    )) then
    raise exception 'square checkout link identity is invalid';
  end if;
  select * into quote from public.platform_fee_quotes where order_id = p_order_id;
  if quote.order_id is null then return false; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'platform-fee:' || quote.location_id::text || ':' || quote.month_start::text, 0
  ));
  select * into target from public.orders where id = p_order_id for update;
  select * into quote from public.platform_fee_quotes where order_id = p_order_id for update;
  if target.id is null or target.status <> 'created' or target.tender_type <> 'square_link'
    or quote.order_id is null or quote.claim_generation <> p_claim_generation
    or quote.cleanup_claimed_at is not null
    or exists (select 1 from public.platform_fees fee where fee.order_id = p_order_id) then
    return false;
  end if;
  if target.square_checkout_url is not null or target.square_payment_link_id is not null then
    return target.square_checkout_url = p_checkout_url
      and target.square_payment_link_id = p_payment_link_id
      and target.square_order_id is not distinct from p_square_order_id;
  end if;
  update public.orders set square_checkout_url = p_checkout_url,
    square_payment_link_id = p_payment_link_id,
    square_order_id = p_square_order_id
  where id = p_order_id;
  return true;
end $$;

create function public.bind_square_payment(
  p_order_id uuid,
  p_claim_generation uuid,
  p_square_order_id text,
  p_square_payment_id text
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  quote public.platform_fee_quotes%rowtype;
  target public.orders%rowtype;
begin
  if p_order_id is null or p_claim_generation is null
    or p_square_order_id is null or p_square_payment_id is null
    or length(p_square_order_id) not between 3 and 255
    or length(p_square_payment_id) not between 3 and 255
    or p_square_order_id ~ '[[:space:]]' or p_square_payment_id ~ '[[:space:]]' then
    raise exception 'square payment identity is invalid';
  end if;
  select * into quote from public.platform_fee_quotes where order_id = p_order_id;
  if quote.order_id is null then return false; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'platform-fee:' || quote.location_id::text || ':' || quote.month_start::text, 0
  ));
  select * into target from public.orders where id = p_order_id for update;
  select * into quote from public.platform_fee_quotes where order_id = p_order_id for update;
  if target.id is null or target.status <> 'created'
    or target.tender_type <> 'square_card'
    or quote.order_id is null or quote.claim_generation <> p_claim_generation
    or quote.cleanup_claimed_at is not null then
    return false;
  end if;
  if target.square_payment_id is not null then
    return target.square_payment_id = p_square_payment_id
      and target.square_order_id = p_square_order_id;
  end if;
  if target.square_order_id is not null
    and target.square_order_id is distinct from p_square_order_id then
    return false;
  end if;
  update public.orders set square_order_id = p_square_order_id,
    square_payment_id = p_square_payment_id
  where id = p_order_id;
  return true;
end $$;

create or replace function app.apply_order_event()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  current_status app.order_status;
  current_tender text;
  current_brand uuid;
begin
  if new.square_event_id is not null and exists (
    select 1 from public.order_events event
    where event.square_event_id = new.square_event_id
  ) then
    return null;
  end if;
  select target.status, target.tender_type, target.brand_id
    into current_status, current_tender, current_brand
    from public.orders target where target.id = new.order_id for update;
  if current_status is null then
    raise exception 'order % does not exist', new.order_id;
  end if;
  if current_brand is distinct from new.brand_id then
    raise exception 'order event brand does not match its order';
  end if;
  if new.source = 'operator' and new.square_refund_id is null
    and new.type in ('paid', 'cancelled')
    and (current_tender <> 'pay_at_pickup' or current_status <> 'created') then
    raise exception 'operator paid/cancelled requires an unpaid pay-at-pickup order';
  end if;
  if new.type = 'cancelled' and current_status = 'created'
    and current_tender = 'square_card' and exists (
      select 1 from public.platform_fee_quotes quote where quote.order_id = new.order_id
    ) then
    raise exception 'square_card_payment_in_flight';
  end if;
  if new.type = current_status then return new; end if;
  if not app.order_transition_allowed(current_status, new.type) then
    if new.source = 'webhook' then
      insert into public.webhook_events (provider, event_id, payload, error)
      values ('square', new.square_event_id, jsonb_build_object(
        'order_id', new.order_id, 'type', new.type, 'snapshot', new.snapshot
      ), format('stale transition %s -> %s ignored', current_status, new.type))
      on conflict (event_id) do nothing;
      return null;
    end if;
    raise exception 'illegal order transition % -> % for order %',
      current_status, new.type, new.order_id;
  end if;
  update public.orders set status = new.type, updated_at = now()
  where id = new.order_id;
  return new;
end $$;
revoke all on function app.apply_order_event()
  from public, anon, authenticated, service_role;

revoke all on function public.claim_platform_fee_quote(
  uuid, uuid, bigint, integer, integer, bigint, timestamptz, timestamptz, boolean
) from public, anon, authenticated;
grant execute on function public.claim_platform_fee_quote(
  uuid, uuid, bigint, integer, integer, bigint, timestamptz, timestamptz, boolean
) to service_role;
revoke all on function public.release_platform_fee_quote(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.release_platform_fee_quote(uuid, uuid) to service_role;
revoke all on function public.bind_square_checkout_link(uuid, uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.bind_square_checkout_link(uuid, uuid, text, text, text)
  to service_role;
revoke all on function public.bind_square_payment(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.bind_square_payment(uuid, uuid, text, text)
  to service_role;

create index operation_outbox_sending_due_idx
  on public.operation_notification_outbox (available_at, id)
  where status = 'sending';

create or replace function public.claim_operation_notification_batch(target_limit integer default 50)
returns setof public.operation_notification_outbox
language plpgsql security definer set search_path = '' as $$
begin
  if target_limit is null or target_limit not between 1 and 200 then
    raise exception using errcode = '22023', message = 'notification_batch_limit_invalid';
  end if;
  with disabled as (
    select outbox.id from public.operation_notification_outbox outbox
    where not app.brand_operations_enabled(outbox.brand_id)
      and outbox.status in ('pending', 'failed', 'sending')
    order by outbox.available_at, outbox.id
    for update of outbox skip locked limit target_limit
  )
  update public.operation_notification_outbox outbox
    set status = 'cancelled', last_error = 'operations_disabled'
  from disabled where outbox.id = disabled.id;
  with uncertain as (
    select outbox.id from public.operation_notification_outbox outbox
    where outbox.status = 'sending' and outbox.available_at <= now()
    order by outbox.available_at, outbox.id
    for update of outbox skip locked limit target_limit
  )
  update public.operation_notification_outbox outbox
    set status = 'cancelled', last_error = 'delivery_uncertain'
  from uncertain where outbox.id = uncertain.id;
  return query with candidates as (
    select outbox.id from public.operation_notification_outbox outbox
    where outbox.status in ('pending', 'failed')
      and outbox.available_at <= now() and outbox.attempt_count < 20
      and app.brand_operations_enabled(outbox.brand_id)
    order by outbox.available_at, outbox.id
    for update of outbox skip locked limit target_limit
  )
  update public.operation_notification_outbox outbox set status = 'sending',
    attempt_count = outbox.attempt_count + 1, last_error = null,
    available_at = now() + interval '5 minutes'
  from candidates where outbox.id = candidates.id returning outbox.*;
end $$;

revoke all on function public.claim_operation_notification_batch(integer)
  from public, anon, authenticated;
grant execute on function public.claim_operation_notification_batch(integer) to service_role;

create or replace function app.assert_bounded_claim_repairs()
returns void language plpgsql stable set search_path = '' as $$
declare
  bind_source text;
  event_source text;
begin
  if not exists (select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'platform_fee_quotes'
      and column_name = 'claim_generation') then
    raise exception 'platform fee quote generation is missing';
  end if;
  if pg_catalog.to_regprocedure(
      'public.claim_platform_fee_quote(uuid,uuid,bigint,integer,integer,bigint,timestamptz,timestamptz,boolean)'
    ) is null
    or pg_catalog.to_regprocedure('public.release_platform_fee_quote(uuid,uuid)') is null
    or pg_catalog.to_regprocedure('public.bind_square_checkout_link(uuid,uuid,text,text,text)') is null
    or pg_catalog.to_regprocedure('public.bind_square_payment(uuid,uuid,text,text)') is null
    or pg_catalog.to_regprocedure('public.release_platform_fee_quote(uuid)') is not null then
    raise exception 'platform fee quote token contract is incomplete';
  end if;
  if pg_catalog.to_regclass('public.operation_outbox_sending_due_idx') is null then
    raise exception 'sending notification recovery index is missing';
  end if;
  select prosrc into bind_source from pg_catalog.pg_proc
  where oid = 'public.bind_square_payment(uuid,uuid,text,text)'::regprocedure;
  select prosrc into event_source from pg_catalog.pg_proc
  where oid = 'app.apply_order_event()'::regprocedure;
  if bind_source !~ 'tender_type.*square_card'
    or bind_source !~ 'square_order_id is distinct from' then
    raise exception 'Square card binding fence is incomplete';
  end if;
  if event_source !~ 'square_card_payment_in_flight' then
    raise exception 'Square card cancellation fence is missing';
  end if;
end $$;
revoke all on function app.assert_bounded_claim_repairs() from public, anon, authenticated;
grant execute on function app.assert_bounded_claim_repairs() to service_role;

select app.register_release(
  '20260908227000', 'repair bounded quote and notification claims',
  'app.assert_bounded_claim_repairs()'::regprocedure
);
