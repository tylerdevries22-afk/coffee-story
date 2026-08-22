-- 0005: square_connections, orders, order_events, platform_fees.
--
-- Rule 2 lives here: orders holds current state, order_events is the
-- append-only truth with a snapshot per transition, and the trigger below is
-- the only thing that moves orders.status -- so state can never change
-- without an event recording how.

create table public.square_connections (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  location_id uuid not null references public.locations (id) on delete cascade,
  merchant_id text not null,
  square_location_id text,
  -- Ciphertext (AES-256-GCM, key = SQUARE_TOKEN_KEY held by the engine's
  -- server environment only). Plaintext tokens never touch the database, and
  -- no RLS policy exposes these rows to any client role at all.
  access_token_encrypted text not null,
  refresh_token_encrypted text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (location_id)
);

alter table public.locations
  add column square_connection_id uuid references public.square_connections (id) on delete set null;

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  location_id uuid not null references public.locations (id) on delete cascade,
  customer_id uuid references public.customers (id) on delete set null,
  status app.order_status not null default 'created',
  fulfillment_type app.fulfillment_type not null default 'pickup',
  channel app.order_channel not null default 'app',
  scheduled_for timestamptz,                       -- pickup window start; null = asap
  -- The cart snapshot: lines, options, per-jurisdiction tax rows, tip,
  -- discounts. Duplicated into every order_events row at each transition.
  totals jsonb not null default '{}'::jsonb,
  -- Denormalized from totals so metrics views never parse JSONB. The engine
  -- writes both in one statement; a CHECK keeps them honest.
  subtotal_cents bigint not null default 0 check (subtotal_cents >= 0),
  tax_cents bigint not null default 0 check (tax_cents >= 0),
  tip_cents bigint not null default 0 check (tip_cents >= 0),
  total_cents bigint not null default 0 check (total_cents >= 0),
  loyalty_redeemed_points bigint not null default 0 check (loyalty_redeemed_points >= 0),
  stored_value_applied_cents bigint not null default 0 check (stored_value_applied_cents >= 0),
  note text not null default '',
  square_order_id text,
  square_payment_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index orders_location_created_idx on public.orders (location_id, created_at desc);
create index orders_brand_created_idx on public.orders (brand_id, created_at desc);
create index orders_customer_idx on public.orders (customer_id, created_at desc);
create index orders_board_idx on public.orders (location_id, status)
  where status in ('paid', 'in_progress', 'ready');

create table public.order_events (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  order_id uuid not null references public.orders (id) on delete cascade,
  type app.order_status not null,                  -- the state this event enters
  snapshot jsonb not null default '{}'::jsonb,     -- cart + payment at the transition
  -- Rule 2: webhook idempotency. UNIQUE ignores NULLs, so internal
  -- transitions (which have no Square event) can repeat freely while a
  -- replayed webhook collides and is dropped by ON CONFLICT DO NOTHING.
  square_event_id text unique,
  actor_user_id uuid,
  source text not null default 'system'
    check (source in ('system', 'customer', 'operator', 'webhook', 'job')),
  created_at timestamptz not null default now()
);

create index order_events_order_idx on public.order_events (order_id, created_at);

-- FKs deferred from 0004 (orders did not exist yet).
alter table public.loyalty_events
  add constraint loyalty_events_order_fk
  foreign key (order_id) references public.orders (id) on delete set null;
alter table public.stored_value_ledger
  add constraint stored_value_order_fk
  foreign key (order_id) references public.orders (id) on delete set null;

-- The legal moves of rule 2's machine. packages/schema/src/order-status.ts
-- mirrors this table and a test keeps the two in sync by reading this file.
create or replace function app.order_transition_allowed(from_status app.order_status, to_status app.order_status)
returns boolean language sql immutable as $$
  select (from_status, to_status) in (
    ('created'::app.order_status,     'paid'::app.order_status),
    ('created'::app.order_status,     'cancelled'::app.order_status),
    ('paid'::app.order_status,        'in_progress'::app.order_status),
    ('paid'::app.order_status,        'cancelled'::app.order_status),
    ('paid'::app.order_status,        'refunded'::app.order_status),
    ('in_progress'::app.order_status, 'ready'::app.order_status),
    ('in_progress'::app.order_status, 'cancelled'::app.order_status),
    ('in_progress'::app.order_status, 'refunded'::app.order_status),
    ('ready'::app.order_status,       'picked_up'::app.order_status),
    ('ready'::app.order_status,       'refunded'::app.order_status),
    ('picked_up'::app.order_status,   'refunded'::app.order_status)
  )
$$;

-- Projects the event onto the order and rejects illegal transitions.
-- A duplicate square_event_id never reaches this trigger: the unique
-- constraint fails the insert first (or ON CONFLICT drops it silently).
create or replace function app.apply_order_event() returns trigger
language plpgsql security definer set search_path = public, app as $$
declare
  current_status app.order_status;
begin
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
    raise exception 'illegal order transition % -> % for order %',
      current_status, new.type, new.order_id;
  end if;
  update public.orders set status = new.type, updated_at = now() where id = new.order_id;
  return new;
end $$;

create trigger order_events_apply before insert on public.order_events
  for each row execute function app.apply_order_event();

-- Rule 3's receipts: one row per Square payment, the platform's revenue.
create table public.platform_fees (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  location_id uuid not null references public.locations (id) on delete cascade,
  order_id uuid references public.orders (id) on delete set null,
  gross_cents bigint not null check (gross_cents >= 0),
  fee_cents bigint not null check (fee_cents >= 0),
  fee_bps_applied integer not null,
  square_payment_id text not null unique,
  created_at timestamptz not null default now()
);

create index platform_fees_location_month_idx on public.platform_fees (location_id, created_at);

create trigger square_connections_touch before update on public.square_connections
  for each row execute function app.touch_updated_at();
create trigger orders_touch before update on public.orders
  for each row execute function app.touch_updated_at();
