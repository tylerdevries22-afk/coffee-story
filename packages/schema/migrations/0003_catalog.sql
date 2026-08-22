-- 0003: menus, menu_categories, menu_items, drops.

create table public.menus (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  name text not null default 'Menu',
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index menus_brand_idx on public.menus (brand_id);

create table public.menu_categories (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  menu_id uuid not null references public.menus (id) on delete cascade,
  title text not null,
  tagline text not null default '',
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index menu_categories_menu_idx on public.menu_categories (menu_id, sort_order);

create table public.menu_items (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  menu_id uuid not null references public.menus (id) on delete cascade,
  category_id uuid not null references public.menu_categories (id) on delete cascade,
  slug text not null,
  name text not null,
  description text not null default '',
  image_url text,
  -- Integer cents, always. sizes: [{"slug":"12","label":"12 oz","price_cents":450}, ...]
  base_price_cents bigint not null check (base_price_cents >= 0),
  sizes jsonb not null default '[]'::jsonb,
  -- Option groups in the shape the customer app's menu-options module reads:
  -- single/multi select, required, maxChoices, dependsOn, priced choices.
  modifiers jsonb not null default '[]'::jsonb,
  -- Availability windows (e.g. breakfast-only), empty = always while listed.
  availability jsonb not null default '{}'::jsonb,
  is_86d boolean not null default false,          -- 86'd = out for the day
  is_listed boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (menu_id, slug)
);

create index menu_items_category_idx on public.menu_items (category_id, sort_order);
create index menu_items_brand_idx on public.menu_items (brand_id);

-- Rule 5 / the rotating-drop model: a scheduled, limited-run feature item.
create table public.drops (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  item_id uuid not null references public.menu_items (id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null check (ends_at > starts_at),
  status text not null default 'scheduled'
    check (status in ('draft', 'scheduled', 'live', 'ended', 'cancelled')),
  hero_asset_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index drops_brand_window_idx on public.drops (brand_id, starts_at desc);

create trigger menus_touch before update on public.menus
  for each row execute function app.touch_updated_at();
create trigger menu_items_touch before update on public.menu_items
  for each row execute function app.touch_updated_at();
create trigger drops_touch before update on public.drops
  for each row execute function app.touch_updated_at();
