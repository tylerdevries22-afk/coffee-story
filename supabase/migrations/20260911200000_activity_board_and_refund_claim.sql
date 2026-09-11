-- Restore the activity board as a definer projection (displays cannot SELECT
-- operation_occurrences, so an invoker view is empty). Idle Square locations
-- have no mutation fence; remediation claim must still lease them. Completing
-- a refund webhook must write the full proof tuple, including submitted_at.

alter view public.activity_board_items set (security_invoker = false);

create or replace function app.assert_hosted_advisor_compatibility()
returns void language plpgsql stable security invoker set search_path = '' as $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_attribute attribute
    where attribute.attrelid = 'app.release_assertions'::regclass
      and attribute.attname = 'assertion'
      and attribute.atttypid = 'pg_catalog.text'::regtype
      and not attribute.attisdropped
  ) then
    raise exception 'release assertions must use an upgrade-safe text identity';
  end if;
  if exists (
    select 1 from pg_catalog.pg_class relation
    where relation.oid = 'public.activity_board_items'::regclass
      and coalesce(relation.reloptions, '{}'::text[]) @> array['security_invoker=true']
  ) then
    raise exception 'activity board view must stay a definer projection';
  end if;
  if exists (
    select 1 from app.release_assertions registered
    where registered.assertion is not null
      and pg_catalog.to_regprocedure(registered.assertion) is null
  ) then
    raise exception 'release registry contains an unresolved assertion';
  end if;
end $$;

revoke all on function app.assert_hosted_advisor_compatibility()
  from public, anon, authenticated;
grant execute on function app.assert_hosted_advisor_compatibility() to service_role;

create or replace function public.claim_due_square_payment_remediations(
  p_now timestamptz,
  p_limit integer default 50
)
returns table (
  order_id uuid,
  brand_id uuid,
  location_id uuid,
  connection_id uuid,
  connection_generation uuid,
  square_order_id text,
  square_payment_id text,
  refund_amount_cents bigint,
  refund_request_key uuid,
  square_refund_id text,
  provider_refund_status text,
  attempt_count integer,
  claim_generation uuid
)
language plpgsql security definer set search_path = '' as $$
begin
  if p_now is null or p_limit is null or p_limit not between 1 and 50
    or p_now < pg_catalog.now() - interval '5 minutes'
    or p_now > pg_catalog.now() + interval '5 minutes' then
    raise exception 'invalid Square payment remediation claim inputs';
  end if;
  update app_private.square_payment_remediation_outbox queued set
    status = 'manual_action_required', claimed_at = null,
    manual_action_required_at = coalesce(queued.manual_action_required_at, p_now),
    last_error_code = 'refund_pending_too_long'
  where queued.provider_refund_status = 'PENDING'
    and queued.submitted_at <= p_now - interval '14 days'
    and queued.available_at <= p_now
    and queued.status in ('submitted', 'processing');
  update app_private.square_payment_remediation_outbox queued set
    status = 'manual_action_required', claimed_at = null,
    manual_action_required_at = coalesce(queued.manual_action_required_at, p_now),
    last_error_code = 'refund_connection_unavailable'
  where queued.status <> 'completed'
    and not exists (select 1 from public.square_connections connection
      where connection.id = queued.connection_id
        and connection.connection_generation = queued.connection_generation)
    and not exists (select 1 from app_private.square_connection_mutation_fences fence
      where fence.location_id = queued.location_id
        and fence.mutation_generation is not null);
  return query with due as materialized (
    select queued.order_id
    from app_private.square_payment_remediation_outbox queued
    left join app_private.square_connection_mutation_fences fence
      on fence.location_id = queued.location_id
    join public.square_connections connection
      on connection.id = queued.connection_id
      and connection.connection_generation = queued.connection_generation
    where queued.available_at <= p_now
      and fence.mutation_generation is null
      and (
        queued.status = 'submitted'
        or queued.status = 'processing'
        or (queued.status in ('pending', 'failed') and queued.attempt_count < 20)
      )
    order by queued.available_at, queued.order_id
    for update of queued, fence skip locked limit p_limit
  ), claimed as (
    update app_private.square_payment_remediation_outbox queued set
      status = 'processing',
      attempt_count = case
        when queued.square_refund_id is null and queued.attempt_count < 20
          then queued.attempt_count + 1
        else queued.attempt_count
      end,
      poll_attempt_count = queued.poll_attempt_count
        + case when queued.square_refund_id is null then 0 else 1 end,
      claimed_at = p_now,
      claim_generation = gen_random_uuid(),
      available_at = p_now + interval '5 minutes',
      last_error_code = null
    from due where queued.order_id = due.order_id returning queued.*
  )
  select claimed.order_id, claimed.brand_id, claimed.location_id,
    claimed.connection_id, claimed.connection_generation,
    claimed.square_order_id, claimed.square_payment_id,
    claimed.refund_amount_cents, claimed.refund_request_key,
    claimed.square_refund_id, claimed.provider_refund_status,
    claimed.attempt_count, claimed.claim_generation
  from claimed;
end $$;

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
  charged_cents := pg_catalog.greatest(
    0, target.total_cents - target.stored_value_applied_cents);
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

create or replace function app.assert_activity_board_definer_and_refund_proof()
returns void language plpgsql stable security invoker set search_path = '' as $$
declare
  rpc constant text := 'public.process_square_refund(uuid,text,text,bigint,text)';
  rpc_proc pg_catalog.pg_proc%rowtype;
begin
  if exists (
    select 1 from pg_catalog.pg_class relation
    where relation.oid = 'public.activity_board_items'::regclass
      and coalesce(relation.reloptions, '{}'::text[]) @> array['security_invoker=true']
  ) then
    raise exception 'activity board view must stay a definer projection';
  end if;
  select proc.* into rpc_proc from pg_catalog.pg_proc proc
  where proc.oid = pg_catalog.to_regprocedure(rpc);
  if rpc_proc.oid is null or not rpc_proc.prosecdef then
    raise exception 'process_square_refund must remain security definer';
  end if;
end $$;

revoke all on function app.assert_activity_board_definer_and_refund_proof()
  from public, anon, authenticated;
grant execute on function app.assert_activity_board_definer_and_refund_proof()
  to service_role;

select app.register_release(
  '20260911200000',
  'definer activity board, idle-location refund claim, refund submitted_at',
  'app.assert_activity_board_definer_and_refund_proof()'::regprocedure
);
