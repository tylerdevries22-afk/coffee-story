-- 0011: makes webhook replays actually idempotent, and gives every delivery a
-- durable record.
--
-- The 0005 comment claimed a replayed square_event_id "never reaches this
-- trigger: the unique constraint fails the insert first" -- but BEFORE
-- triggers fire before conflict detection. A replay arriving after the order
-- had moved on (order in_progress, event re-asserting paid) raised on the
-- transition check before the UNIQUE was ever consulted, the route returned
-- 409, and Square retried forever.

create or replace function app.apply_order_event() returns trigger
language plpgsql security definer set search_path = public, app as $$
declare
  current_status app.order_status;
begin
  -- A replayed webhook delivery is a success we have already had: skip the
  -- insert entirely (returning null from a BEFORE trigger drops the row)
  -- before the transition check can object to it.
  if new.square_event_id is not null and exists (
    select 1 from public.order_events e where e.square_event_id = new.square_event_id
  ) then
    return null;
  end if;

  select status into current_status from public.orders where id = new.order_id for update;
  if current_status is null then
    raise exception 'order % does not exist', new.order_id;
  end if;
  if new.type = current_status then
    -- Idempotent re-assertion (e.g. two webhook deliveries with different
    -- event ids for the same payment state): record it, move nothing.
    return new;
  end if;
  if not app.order_transition_allowed(current_status, new.type) then
    if new.source = 'webhook' then
      -- A stale webhook (payment.updated landing after the shop already
      -- advanced the order) is not an error the sender can fix; swallow it
      -- and leave the audit trail in webhook_events.
      insert into public.webhook_events (provider, event_id, payload, error)
      values ('square', new.square_event_id,
              jsonb_build_object('order_id', new.order_id, 'type', new.type, 'snapshot', new.snapshot),
              format('stale transition %s -> %s ignored', current_status, new.type))
      on conflict (event_id) do nothing;
      return null;
    end if;
    -- Operator and system sources still fail loudly: the offline queue's
    -- conflict surface depends on it.
    raise exception 'illegal order transition % -> % for order %',
      current_status, new.type, new.order_id;
  end if;
  update public.orders set status = new.type, updated_at = now() where id = new.order_id;
  return new;
end $$;

-- Raw delivery log: what arrived, when, and what became of it. The webhook
-- route writes a row per delivery; the trigger above adds rows for stale
-- transitions it swallowed. Service-role only (RLS on, no policies).
create table public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'square',
  event_id text unique,
  payload jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error text
);

alter table public.webhook_events enable row level security;

create index webhook_events_received_idx on public.webhook_events (received_at desc);
