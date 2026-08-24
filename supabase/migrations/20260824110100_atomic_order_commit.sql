-- One checkout commit, one database transaction. The order row and its
-- required initial events must never become independently durable: an HTTP
-- retry under the same client key may return a complete winner, never a row
-- whose event write failed.

-- A retry must be decided from immutable checkout input, not from today's
-- menu or availability. The engine stores this SHA-256 digest in the order
-- snapshot and asks this service-only function before it reads any mutable
-- ordering state. A different request reusing the key is a conflict; the
-- exact request receives the already-committed result.
create or replace function public.resolve_order_replay(
  p_brand_id uuid,
  p_client_key uuid,
  p_request_fingerprint text
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  committed public.orders%rowtype;
begin
  if p_brand_id is null then
    raise exception using errcode = '22023', message = 'order brand is required';
  end if;
  if p_client_key is null then
    raise exception using errcode = '22023', message = 'order idempotency key is required';
  end if;
  if p_request_fingerprint is null
     or p_request_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'order request fingerprint is invalid';
  end if;

  -- Wait for an in-flight writer of this tenant + key. Without the lock, a
  -- lost-response retry could observe no uncommitted row, continue into
  -- mutable catalog validation, and fail on drift before seeing the winner.
  perform pg_advisory_xact_lock(hashtextextended(
    p_brand_id::text || ':' || p_client_key::text,
    0
  ));
  select target.* into committed
    from public.orders target
   where target.brand_id = p_brand_id
     and target.client_key = p_client_key
   for share;
  if not found then return null; end if;

  if committed.totals ->> 'request_fingerprint'
       is distinct from p_request_fingerprint then
    raise exception using
      errcode = '22023',
      message = 'idempotency key was already used for a different order request';
  end if;
  if not exists (
    select 1 from public.order_events event
     where event.order_id = committed.id
       and event.brand_id = committed.brand_id
       and event.type = 'created'
       and event.snapshot = committed.totals
  ) then
    raise exception 'order % is incomplete: created event is missing', committed.id;
  end if;
  if committed.tender_type = 'external' and not exists (
    select 1 from public.order_events event
     where event.order_id = committed.id
       and event.brand_id = committed.brand_id
       and event.type = 'paid'
  ) then
    raise exception 'order % is incomplete: external settlement event is missing', committed.id;
  end if;

  return jsonb_build_object(
    'order', jsonb_build_object(
      'id', committed.id,
      'status', committed.status,
      'subtotal_cents', committed.subtotal_cents,
      'tax_cents', committed.tax_cents,
      'tip_cents', committed.tip_cents,
      'total_cents', committed.total_cents,
      'daily_number', committed.daily_number
    ),
    'replayed', true
  );
end $$;

revoke all on function public.resolve_order_replay(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.resolve_order_replay(uuid, uuid, text)
  to service_role;

create or replace function public.commit_order(
  p_brand_id uuid,
  p_location_id uuid,
  p_customer_id uuid,
  p_fulfillment_type app.fulfillment_type,
  p_scheduled_for timestamptz,
  p_note text,
  p_totals jsonb,
  p_subtotal_cents bigint,
  p_tax_cents bigint,
  p_tip_cents bigint,
  p_total_cents bigint,
  p_tender_type text,
  p_channel app.order_channel,
  p_guest_label text,
  p_device_id uuid,
  p_client_key uuid,
  p_request_fingerprint text,
  p_actor_user_id uuid
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  committed public.orders%rowtype;
  replayed jsonb;
  event_at timestamptz := clock_timestamp();
begin
  if p_brand_id is null then
    raise exception using errcode = '22023', message = 'order brand is required';
  end if;
  if p_client_key is null then
    raise exception using errcode = '22023', message = 'order idempotency key is required';
  end if;
  if p_request_fingerprint is null
     or p_request_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'order request fingerprint is invalid';
  end if;

  -- resolve_order_replay acquires the tenant + key transaction lock. If it
  -- finds no winner, that same lock remains held through the insert below.
  replayed := public.resolve_order_replay(
    p_brand_id, p_client_key, p_request_fingerprint
  );
  if replayed is not null then return replayed; end if;

  if p_subtotal_cents is null or p_tax_cents is null
     or p_tip_cents is null or p_total_cents is null
     or p_subtotal_cents < 0 or p_tax_cents < 0
     or p_tip_cents < 0 or p_total_cents < 0
     or p_total_cents::numeric <> p_subtotal_cents::numeric
       + p_tax_cents::numeric + p_tip_cents::numeric then
    raise exception using
      errcode = '22023',
      message = 'order cents must be non-negative and total must equal subtotal + tax + tip';
  end if;
  if jsonb_typeof(p_totals) is distinct from 'object'
     or p_totals -> 'subtotal_cents' is distinct from to_jsonb(p_subtotal_cents)
     or p_totals -> 'tax_cents' is distinct from to_jsonb(p_tax_cents)
     or p_totals -> 'tip_cents' is distinct from to_jsonb(p_tip_cents)
     or p_totals -> 'total_cents' is distinct from to_jsonb(p_total_cents)
     or p_totals ->> 'tender_type' is distinct from p_tender_type
     or p_totals ->> 'request_fingerprint' is distinct from p_request_fingerprint then
    raise exception using
      errcode = '22023',
      message = 'order snapshot does not match its indexed totals';
  end if;

  -- The individual foreign keys only prove that each UUID exists. They do
  -- not prove that the location, customer and device belong to this brand,
  -- so keep that tenant invariant inside the one privileged write path.
  perform 1 from public.locations location
   where location.id = p_location_id and location.brand_id = p_brand_id
   for share;
  if not found then
    raise exception using errcode = '23503', message = 'location does not belong to order brand';
  end if;
  if p_customer_id is not null then
    perform 1 from public.customers customer
     where customer.id = p_customer_id and customer.brand_id = p_brand_id
     for share;
    if not found then
      raise exception using errcode = '23503', message = 'customer does not belong to order brand';
    end if;
  end if;
  if p_device_id is not null then
    perform 1 from public.devices device
     where device.id = p_device_id
       and device.brand_id = p_brand_id
       and device.location_id = p_location_id
       and device.paired_at is not null
       and device.revoked_at is null
       and (
         (device.role = 'kiosk' and p_channel = 'kiosk')
         or (device.role = 'pos' and p_channel = 'pos')
       )
     for share;
    if not found then
      raise exception using
        errcode = '23503',
        message = 'device is not an active ordering device for this brand, location and channel';
    end if;
  end if;
  if p_device_id is null and p_channel = 'kiosk' then
    raise exception using errcode = '22023', message = 'kiosk orders require a paired kiosk device';
  end if;

  insert into public.orders (
    brand_id, location_id, customer_id, fulfillment_type, scheduled_for,
    note, totals, subtotal_cents, tax_cents, tip_cents, total_cents,
    tender_type, channel, guest_label, device_id, client_key
  ) values (
    p_brand_id, p_location_id, p_customer_id, p_fulfillment_type, p_scheduled_for,
    p_note, p_totals, p_subtotal_cents, p_tax_cents, p_tip_cents, p_total_cents,
    p_tender_type, p_channel, p_guest_label, p_device_id, p_client_key
  )
  on conflict (brand_id, client_key) where client_key is not null do nothing
  returning * into committed;

  if committed.id is null then
    -- Backstop a writer that bypassed this function and therefore did not
    -- participate in the advisory lock. The unique index still elects one
    -- winner; resolve it under the same fingerprint contract.
    replayed := public.resolve_order_replay(
      p_brand_id, p_client_key, p_request_fingerprint
    );
    if replayed is null then
      raise exception 'conflicting order could not be loaded';
    end if;
    return replayed;
  end if;

  insert into public.order_events (
    brand_id, order_id, type, snapshot, actor_user_id, source, created_at
  ) values (
    committed.brand_id, committed.id, 'created', committed.totals,
    p_actor_user_id, 'customer', event_at
  );

  -- External means an attended POS already settled the money. Pay at pickup
  -- remains created until staff explicitly records collection.
  if committed.tender_type = 'external' then
    insert into public.order_events (
      brand_id, order_id, type, snapshot, actor_user_id, source, created_at
    ) values (
      committed.brand_id, committed.id, 'paid',
      committed.totals || jsonb_build_object('settlement', 'external'),
      null, 'system', event_at + interval '1 microsecond'
    );
    select target.* into committed
      from public.orders target
     where target.id = committed.id;
  end if;

  return jsonb_build_object(
    'order', jsonb_build_object(
      'id', committed.id,
      'status', committed.status,
      'subtotal_cents', committed.subtotal_cents,
      'tax_cents', committed.tax_cents,
      'tip_cents', committed.tip_cents,
      'total_cents', committed.total_cents,
      'daily_number', committed.daily_number
    ),
    'replayed', false
  );
end $$;

revoke all on function public.commit_order(
  uuid, uuid, uuid, app.fulfillment_type, timestamptz, text, jsonb,
  bigint, bigint, bigint, bigint, text, app.order_channel, text, uuid, uuid, text, uuid
) from public, anon, authenticated;
grant execute on function public.commit_order(
  uuid, uuid, uuid, app.fulfillment_type, timestamptz, text, jsonb,
  bigint, bigint, bigint, bigint, text, app.order_channel, text, uuid, uuid, text, uuid
) to service_role;

-- Staff write ordinary state events directly under RLS. Paying or cancelling
-- money handled elsewhere is not an ordinary state change: only cash at the
-- counter may take either path. Refund identifiers and their typed amount are
-- reserved for the service-role refund path, never caller-authored JSON.
alter table public.order_events
  add column refund_cents bigint,
  add column refund_request_key uuid;

update public.order_events event
   set refund_cents = (event.snapshot ->> 'refunded_cents')::bigint
 where event.square_refund_id is not null
   and event.snapshot ->> 'refunded_cents' ~ '^[1-9][0-9]{0,17}$';

alter table public.order_events
  add constraint order_events_refund_fields_complete check (
    (square_refund_id is null) = (refund_cents is null)
    and (refund_cents is null or refund_cents > 0)
    and (refund_request_key is null or square_refund_id is not null)
    and (
      square_refund_id is null
      or source = 'webhook'
      or (source = 'operator' and refund_request_key is not null)
    )
    and (
      refund_request_key is null
      or coalesce((
        snapshot ->> 'request_key' = refund_request_key::text
        and (
          (
            jsonb_typeof(snapshot -> 'requested_amount') = 'string'
            and snapshot ->> 'requested_amount' = 'full'
          )
          or (
            jsonb_typeof(snapshot -> 'requested_amount') = 'number'
            and snapshot -> 'requested_amount' = to_jsonb(refund_cents)
          )
        )
      ), false)
    )
  );

create unique index order_events_refund_request_idx
  on public.order_events (brand_id, refund_request_key)
  where refund_request_key is not null;

comment on column public.order_events.refund_cents is
  'Typed refund amount paired with square_refund_id by the trusted refund trigger.';
comment on column public.order_events.refund_request_key is
  'Brand-scoped attended request UUID; a webhook winner may acquire it through claim_refund_request.';

-- Events are append-only to API callers. The service role alone may attach an
-- attended request to a webhook row that won the square_refund_id race.
revoke update on public.order_events from public, anon, authenticated;

alter policy order_events_insert on public.order_events with check (
  source = 'operator'
  and type in ('paid', 'in_progress', 'ready', 'picked_up', 'cancelled')
  and actor_user_id = (select auth.uid())
  and square_event_id is null
  and square_refund_id is null
  and refund_cents is null
  and refund_request_key is null
  and not (snapshot ?| array[
    'refund_id', 'square_refund_id', 'refunded_cents',
    'amount_cents', 'requested_amount', 'request_key'
  ])
  and exists (
    select 1 from public.orders target
    where target.id = order_events.order_id
      and target.brand_id = order_events.brand_id
      and app.at_location(target.brand_id, target.location_id)
      and (
        order_events.type in ('in_progress', 'ready', 'picked_up')
        or (
          order_events.type in ('paid', 'cancelled')
          and target.tender_type = 'pay_at_pickup'
        )
      )
  )
);

-- RLS WITH CHECK runs after BEFORE ROW triggers. Since order_events_apply
-- advances the order in that phase, a policy subquery cannot reliably inspect
-- the pre-transition status. Enforce the unpaid cash edge inside that same
-- row-locking trigger instead: this closes the race between two attended
-- writes and still leaves RLS responsible for tenant/location/tender scope.
create or replace function app.apply_order_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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
    from public.orders target
   where target.id = new.order_id
   for update;
  if current_status is null then
    raise exception 'order % does not exist', new.order_id;
  end if;
  if current_brand is distinct from new.brand_id then
    raise exception 'order event brand does not match its order';
  end if;
  if new.source = 'operator'
     and new.square_refund_id is null
     and new.type in ('paid', 'cancelled')
     and (current_tender <> 'pay_at_pickup' or current_status <> 'created') then
    raise exception 'operator paid/cancelled requires an unpaid pay-at-pickup order';
  end if;
  if new.type = current_status then return new; end if;

  if not app.order_transition_allowed(current_status, new.type) then
    if new.source = 'webhook' then
      insert into public.webhook_events (provider, event_id, payload, error)
      values (
        'square',
        new.square_event_id,
        jsonb_build_object(
          'order_id', new.order_id,
          'type', new.type,
          'snapshot', new.snapshot
        ),
        format('stale transition %s -> %s ignored', current_status, new.type)
      )
      on conflict (event_id) do nothing;
      return null;
    end if;
    raise exception 'illegal order transition % -> % for order %',
      current_status, new.type, new.order_id;
  end if;
  update public.orders
     set status = new.type, updated_at = now()
   where id = new.order_id;
  return new;
end $$;

revoke all on function app.apply_order_event()
  from public, anon, authenticated, service_role;

-- Both refund writers predate the typed column: the webhook already supplies
-- square_refund_id, while the attended refund route carries its processor id
-- and amount in the snapshot. Canonicalize those inputs once, but accept the
-- legacy snapshot shape only from a service-role request. The AFTER trigger
-- below consumes only these typed fields and never reparses general JSON.
create or replace function app.canonicalize_order_refund_event()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  manual_refund_id text := new.snapshot ->> 'refund_id';
  manual_request_key_text text := new.snapshot ->> 'request_key';
  refund_id text;
  refund_cents_text text;
  request_key uuid;
begin
  if manual_refund_id is not null then
    if new.source <> 'operator'
       or current_user::text <> 'service_role' then
      raise exception 'manual refund fields require the service role';
    end if;
    if new.square_refund_id is not null
       and new.square_refund_id is distinct from manual_refund_id then
      raise exception 'refund identifiers disagree';
    end if;
    refund_id := manual_refund_id;
    refund_cents_text := new.snapshot ->> 'amount_cents';
    if manual_request_key_text is null
       or manual_request_key_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'manual refund event needs a UUID request key';
    end if;
    request_key := manual_request_key_text::uuid;
    if new.refund_request_key is not null
       and new.refund_request_key is distinct from request_key then
      raise exception 'refund request keys disagree';
    end if;
  elsif new.square_refund_id is not null then
    if new.source <> 'webhook' then
      raise exception 'square_refund_id is reserved for the trusted refund path';
    end if;
    if new.refund_request_key is not null then
      raise exception 'webhook refunds cannot claim an attended request key';
    end if;
    refund_id := new.square_refund_id;
    refund_cents_text := new.snapshot ->> 'refunded_cents';
  elsif new.refund_cents is not null or new.refund_request_key is not null then
    raise exception 'typed refund fields require a trusted refund identifier';
  else
    return new;
  end if;

  if refund_id = '' or length(refund_id) > 180
     or refund_cents_text is null
     or refund_cents_text !~ '^[1-9][0-9]{0,17}$' then
    raise exception 'refund event needs a bounded id and positive integer amount';
  end if;
  if new.refund_cents is not null
     and new.refund_cents is distinct from refund_cents_text::bigint then
    raise exception 'refund amounts disagree';
  end if;
  new.square_refund_id := refund_id;
  new.refund_cents := refund_cents_text::bigint;
  new.refund_request_key := request_key;
  return new;
end $$;

drop trigger if exists order_events_refund_canonicalize on public.order_events;
drop trigger if exists order_events_00_refund_canonicalize on public.order_events;
-- PostgreSQL runs same-kind triggers by name. Canonicalize/reject untrusted
-- refund fields before the privileged order_events_apply trigger takes a lock
-- or changes order state.
create trigger order_events_00_refund_canonicalize
  before insert on public.order_events
  for each row execute function app.canonicalize_order_refund_event();

revoke all on function app.canonicalize_order_refund_event()
  from public, anon, authenticated, service_role;

-- A Square webhook can land between RefundPayment succeeding and the attended
-- event insert. In that ordering, the webhook owns the unique processor id.
-- Claim that exact typed winner so every later same-key retry still resolves
-- before mutable status/balance checks. The row lock makes competing claims
-- deterministic; a different key or request intent is a conflict.
create or replace function public.claim_refund_request(
  p_brand_id uuid,
  p_order_id uuid,
  p_square_refund_id text,
  p_refund_cents bigint,
  p_refund_request_key uuid,
  p_requested_amount jsonb
) returns public.order_events
language plpgsql
security invoker
set search_path = ''
as $$
declare
  claimed public.order_events%rowtype;
begin
  if p_brand_id is null or p_order_id is null
     or p_square_refund_id is null or p_square_refund_id = ''
     or p_refund_cents is null or p_refund_cents <= 0
     or p_refund_request_key is null then
    raise exception using
      errcode = '22023',
      message = 'refund claim identity is incomplete';
  end if;
  if p_requested_amount is null or not (
    (jsonb_typeof(p_requested_amount) = 'string' and p_requested_amount #>> '{}' = 'full')
    or (
      jsonb_typeof(p_requested_amount) = 'number'
      and p_requested_amount = to_jsonb(p_refund_cents)
    )
  ) then
    raise exception using
      errcode = '22023',
      message = 'refund claim requested amount does not match the processor refund';
  end if;

  select event.* into claimed
    from public.order_events event
   where event.square_refund_id = p_square_refund_id
   for update;
  if not found
     or claimed.brand_id is distinct from p_brand_id
     or claimed.order_id is distinct from p_order_id
     or claimed.refund_cents is distinct from p_refund_cents
     or claimed.source <> 'webhook' then
    raise exception using
      errcode = '22023',
      message = 'refund claim does not match the webhook winner';
  end if;

  if claimed.refund_request_key is null then
    update public.order_events event
       set refund_request_key = p_refund_request_key,
           snapshot = event.snapshot || jsonb_build_object(
             'request_key', p_refund_request_key::text,
             'requested_amount', p_requested_amount
           )
     where event.id = claimed.id
     returning event.* into claimed;
  elsif claimed.refund_request_key is distinct from p_refund_request_key
     or claimed.snapshot ->> 'request_key' is distinct from p_refund_request_key::text
     or claimed.snapshot -> 'requested_amount' is distinct from p_requested_amount then
    raise exception using
      errcode = '22023',
      message = 'refund request key was already used for a different refund intent';
  end if;
  return claimed;
exception when unique_violation then
  raise exception using
    errcode = '22023',
    message = 'refund request key was already used for a different refund intent';
end $$;

revoke all on function public.claim_refund_request(uuid, uuid, text, bigint, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.claim_refund_request(uuid, uuid, text, bigint, uuid, jsonb)
  to service_role;

-- Webhook refunds and attended refunds share one typed accounting ledger.
-- The previous webhook function summed only snapshot.refunded_cents, which
-- ignored attended refunds stored as snapshot.amount_cents and could leave a
-- fully refunded order in a non-terminal state. Lock the order, total the
-- canonical typed column, and let the event side-effect trigger below perform
-- the one idempotent loyalty reversal.
create or replace function public.process_square_refund(
  target_order uuid,
  square_event text,
  square_refund text,
  refunded_cents bigint,
  square_event_type text
) returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target public.orders%rowtype;
  charged_cents bigint;
  refunded_before bigint;
  event_type app.order_status;
begin
  if square_event is null or square_event = ''
     or square_refund is null or square_refund = '' then
    raise exception 'Square event and refund identifiers are required';
  end if;
  if refunded_cents is null or refunded_cents <= 0 then
    raise exception 'refund amount must be positive';
  end if;

  select candidate.* into target
    from public.orders candidate
   where candidate.id = target_order
   for update;
  if not found then raise exception 'order does not exist'; end if;
  if exists (
    select 1 from public.order_events event
     where event.square_event_id = square_event
        or event.square_refund_id = square_refund
  ) then return false; end if;

  charged_cents := greatest(0, target.total_cents - target.stored_value_applied_cents);
  if charged_cents = 0 then raise exception 'order has no Square-funded amount'; end if;
  select coalesce(sum(event.refund_cents), 0)
    into refunded_before
    from public.order_events event
   where event.order_id = target_order
     and event.square_refund_id is not null;

  event_type := case
    when refunded_before + refunded_cents >= charged_cents
      then 'refunded'::app.order_status
    else target.status
  end;
  insert into public.order_events (
    brand_id, order_id, type, snapshot, square_event_id,
    square_refund_id, refund_cents, source
  ) values (
    target.brand_id,
    target.id,
    event_type,
    jsonb_build_object(
      'square_event', square_event_type,
      'square_event_id', square_event,
      'square_refund_id', square_refund,
      'refunded_cents', refunded_cents
    ),
    square_event,
    square_refund,
    refunded_cents,
    'webhook'
  );
  return true;
exception when unique_violation then
  return false;
end $$;

revoke all on function public.process_square_refund(uuid, text, text, bigint, text)
  from public, anon, authenticated;
grant execute on function public.process_square_refund(uuid, text, text, bigint, text)
  to service_role;

-- Money-state side effects follow typed events in the same transaction. The
-- loyalty RPCs are idempotent by order/cause, so re-assertions stay harmless.
create or replace function app.apply_order_event_side_effects()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.orders%rowtype;
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
    perform public.loyalty_record_earn(
      target.brand_id, target.customer_id, target.id, target.subtotal_cents / 10
    );
  else
    perform public.loyalty_reverse_earn(
      target.brand_id, target.customer_id, target.id,
      target.total_cents, target.total_cents, 'cancel:' || target.id::text
    );
  end if;
  return new;
end $$;

drop trigger if exists order_events_side_effects on public.order_events;
create trigger order_events_side_effects
  after insert on public.order_events
  for each row execute function app.apply_order_event_side_effects();

-- A trigger does not need caller EXECUTE at runtime. Keep this definer helper
-- uncallable even by API roles; only the table trigger may enter it.
revoke all on function app.apply_order_event_side_effects()
  from public, anon, authenticated, service_role;
