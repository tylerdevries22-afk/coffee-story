-- 0004: customers, loyalty, stored value, referrals. Customer identity is
-- brand-scoped (rule 1): the same person at two brands is two customer rows,
-- because brands must not see each other's guests.

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  phone text,
  full_name text not null default '',
  email text,
  push_token text,
  sms_opt_in boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (brand_id, user_id),
  unique (brand_id, phone)
);

create index customers_brand_idx on public.customers (brand_id);

create table public.loyalty_accounts (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  customer_id uuid not null references public.customers (id) on delete cascade,
  points_balance bigint not null default 0 check (points_balance >= 0),
  lifetime_points bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (customer_id)
);

create index loyalty_accounts_brand_idx on public.loyalty_accounts (brand_id);

-- Append-only, like order_events: the balance above is a projection the
-- engine maintains inside the same transaction that writes the event.
create table public.loyalty_events (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  account_id uuid not null references public.loyalty_accounts (id) on delete cascade,
  order_id uuid,                                  -- FK added in 0005 (orders comes later)
  type text not null check (type in ('earn', 'redeem', 'adjust', 'reverse')),
  points bigint not null,
  note text not null default '',
  created_at timestamptz not null default now()
);

create index loyalty_events_account_idx on public.loyalty_events (account_id, created_at desc);

-- Gift-card / preloaded balance money movements, integer cents, append-only.
create table public.stored_value_ledger (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  customer_id uuid not null references public.customers (id) on delete cascade,
  order_id uuid,                                  -- FK added in 0005
  type text not null check (type in ('load', 'spend', 'refund', 'adjust', 'gift_received')),
  amount_cents bigint not null,
  balance_after_cents bigint not null check (balance_after_cents >= 0),
  note text not null default '',
  created_at timestamptz not null default now()
);

create index stored_value_customer_idx on public.stored_value_ledger (customer_id, created_at desc);

create table public.referrals (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  referrer_customer_id uuid not null references public.customers (id) on delete cascade,
  code text not null,
  referred_customer_id uuid references public.customers (id) on delete set null,
  status text not null default 'issued'
    check (status in ('issued', 'claimed', 'rewarded', 'expired')),
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  unique (brand_id, code)
);

create index referrals_referrer_idx on public.referrals (referrer_customer_id);

create trigger customers_touch before update on public.customers
  for each row execute function app.touch_updated_at();
create trigger loyalty_accounts_touch before update on public.loyalty_accounts
  for each row execute function app.touch_updated_at();
