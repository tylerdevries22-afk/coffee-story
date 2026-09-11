-- Schema-qualified pg_catalog.greatest(...) is not a real catalog function
-- (42883 under search_path=''). Use the SQL special form greatest(...).

create or replace function public.process_square_refund(
  target_order uuid,
  square_event text,
  square_refund text,
  refunded_cents bigint,
  square_event_type text
)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare
  target public.orders%rowtype;
  queued app_private.square_payment_remediation_outbox%rowtype;
  prior public.order_events%rowtype;
  charged_cents bigint;
  refunded_before bigint;
  event_type app.order_status;
begin
  if target_order is null or square_event is null or square_refund is null
    or square_event_type is null or refunded_cents is null or refunded_cents <= 0
    or pg_catalog.octet_length(square_event) not between 3 and 255
    or pg_catalog.octet_length(square_refund) not between 3 and 255
    or pg_catalog.octet_length(square_event_type) not between 1 and 128
    or square_event ~ '[[:space:]]' or square_refund ~ '[[:space:]]' then
    raise exception 'invalid Square refund result';
  end if;
  select candidate.* into target from public.orders candidate
  where candidate.id = target_order for update;
  if target.id is null then raise exception 'order does not exist'; end if;
  select candidate.* into queued
  from app_private.square_payment_remediation_outbox candidate
  where candidate.order_id = target_order for update;
  select event.* into prior from public.order_events event
  where event.square_event_id = square_event
    or event.square_refund_id = square_refund
  order by (event.square_refund_id = square_refund) desc limit 1;
  if queued.order_id is not null then
    if target.status <> 'cancelled'
      or target.brand_id is distinct from queued.brand_id
      or target.location_id is distinct from queued.location_id
      or target.square_order_id is distinct from queued.square_order_id
      or target.square_payment_id is distinct from queued.square_payment_id
      or refunded_cents is distinct from queued.refund_amount_cents
      or (queued.square_refund_id is not null
        and queued.square_refund_id is distinct from square_refund)
      or exists (select 1 from public.order_events event
        where (event.square_event_id = square_event
            or event.square_refund_id = square_refund)
          and (event.order_id is distinct from target_order
            or event.square_refund_id is distinct from square_refund
            or event.refund_cents is distinct from refunded_cents
            or event.snapshot ->> 'square_payment_id' is distinct from
              queued.square_payment_id)) then
      raise exception 'Square refund does not match its remediation intent';
    end if;
    if prior.id is null then
      insert into public.order_events (
        brand_id, order_id, type, snapshot, square_event_id,
        square_refund_id, refund_cents, source
      ) values (
        target.brand_id, target.id, 'cancelled', pg_catalog.jsonb_build_object(
          'square_event', square_event_type,
          'square_event_id', square_event,
          'square_refund_id', square_refund,
          'square_payment_id', queued.square_payment_id,
          'refunded_cents', refunded_cents,
          'currency', 'USD',
          'reason', 'late_square_settlement_remediation'
        ), square_event, square_refund, refunded_cents, 'webhook'
      );
    end if;
    update app_private.square_payment_remediation_outbox candidate set
      status = 'completed', square_refund_id = square_refund,
      provider_refund_status = 'COMPLETED',
      provider_refund_payment_id = candidate.square_payment_id,
      provider_refund_amount_cents = candidate.refund_amount_cents,
      provider_refund_currency = 'USD',
      submitted_at = coalesce(candidate.submitted_at, pg_catalog.now()),
      claimed_at = null,
      completed_at = coalesce(candidate.completed_at, pg_catalog.now()),
      manual_action_required_at = null, last_error_code = null
    where candidate.order_id = target_order;
    return prior.id is null;
  end if;
  if prior.id is not null then return false; end if;
  charged_cents := greatest(
    0::bigint, target.total_cents - target.stored_value_applied_cents);
  if charged_cents = 0 then raise exception 'order has no Square-funded amount'; end if;
  select coalesce(pg_catalog.sum(event.refund_cents), 0) into refunded_before
  from public.order_events event where event.order_id = target_order
    and event.square_refund_id is not null;
  event_type := case when refunded_before + refunded_cents >= charged_cents
    then 'refunded'::app.order_status else target.status end;
  insert into public.order_events (
    brand_id, order_id, type, snapshot, square_event_id,
    square_refund_id, refund_cents, source
  ) values (
    target.brand_id, target.id, event_type, pg_catalog.jsonb_build_object(
      'square_event', square_event_type, 'square_event_id', square_event,
      'square_refund_id', square_refund, 'refunded_cents', refunded_cents
    ), square_event, square_refund, refunded_cents, 'webhook'
  );
  return true;
exception when unique_violation then
  return false;
end $$;

alter function public.process_square_refund(uuid, text, text, bigint, text)
  security definer;

do $$
declare
  rpc constant text := 'public.process_square_refund(uuid,text,text,bigint,text)';
  rpc_proc pg_catalog.pg_proc%rowtype;
begin
  select proc.* into rpc_proc from pg_catalog.pg_proc proc
  where proc.oid = pg_catalog.to_regprocedure(rpc);
  if rpc_proc.oid is null or not rpc_proc.prosecdef then
    raise exception 'process_square_refund must remain security definer';
  end if;
end $$;

-- Linked may already have this release row from a partial apply; stay idempotent.
do $$
begin
  if not exists (
    select 1 from app.release_assertions where release = '20260911250000'
  ) then
    perform app.register_release(
      '20260911250000',
      'fix process_square_refund greatest under empty search_path',
      'app.assert_activity_board_definer_and_refund_proof()'::regprocedure
    );
  end if;
end $$;
