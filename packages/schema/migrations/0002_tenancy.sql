-- 0002: brands, locations, brand_users. Rule 1: every table carries brand_id
-- (brands itself is the root), and location_id where relevant.

create table public.brands (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  name text not null,

  -- Rule 3: platform take, in basis points, with a per-location monthly
  -- volume tier: once a location's gross for the calendar month passes
  -- tier_threshold_cents, later payments that month are charged fee_bps_tier2.
  fee_bps integer not null default 300 check (fee_bps between 0 and 10000),
  fee_bps_tier2 integer not null default 150 check (fee_bps_tier2 between 0 and 10000),
  tier_threshold_cents bigint not null default 2000000 check (tier_threshold_cents >= 0),

  -- Rule 5: feature flags live on the brand row, as columns so a migration
  -- adding a flag is explicit and queries don't fish in JSONB.
  drops boolean not null default true,
  catering boolean not null default false,
  delivery boolean not null default false,
  multi_location boolean not null default false,
  sms boolean not null default false,
  stored_value boolean not null default false,
  referrals boolean not null default false,

  -- Rule 4: design tokens, type pairing, copy dictionary, illustration
  -- palette -- everything the apps hydrate at runtime. Shape documented in
  -- tenants/_template/brand.json.
  brand_config jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  name text not null,
  address jsonb not null default '{}'::jsonb,   -- street, city, region, postal, lat/lng
  -- Posted hours, one row per weekday:
  -- { "mon": [{"open": "08:00", "close": "23:00"}], ... } -- [] = closed.
  hours jsonb not null default '{}'::jsonb,
  timezone text not null default 'America/Denver',
  -- Filled by 0005 once square_connections exists (the FKs are circular).
  -- square_connection_id uuid
  ordering_paused boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index locations_brand_idx on public.locations (brand_id);

-- Staff membership. A person can hold roles at several brands (a consultant,
-- or the platform operator); the JWT is minted for one brand at a time.
create table public.brand_users (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  brand_id uuid not null references public.brands (id) on delete cascade,
  role app.brand_role not null,
  location_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (user_id, brand_id)
);

create index brand_users_brand_idx on public.brand_users (brand_id);
create index brand_users_user_idx on public.brand_users (user_id);

create or replace function app.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger brands_touch before update on public.brands
  for each row execute function app.touch_updated_at();
create trigger locations_touch before update on public.locations
  for each row execute function app.touch_updated_at();
