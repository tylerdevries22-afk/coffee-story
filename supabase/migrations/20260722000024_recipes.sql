-- 0024: recipes and the day's prep, for the bench tablet.
--
-- Recipes are versioned rather than edited in place. A batch records which
-- version it was made from, so "why did Tuesday's tray come out different"
-- has an answer, and a corrected recipe never rewrites the history of what was
-- already baked.
--
-- Prep is driven by the drop lineup rather than a second scheduling system:
-- drops already carries the week's window, so the day's bake list is a join.

create table public.recipes (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  menu_item_id uuid not null references public.menu_items (id) on delete cascade,
  version integer not null default 1 check (version > 0),

  -- [{ "n": 1, "text": "Cream butter and sugar 4 min", "minutes": 4 }, ...]
  -- Steps carry their own timing so the station can offer a timer inline
  -- instead of asking a baker to read a duration out of prose.
  steps jsonb not null default '[]'::jsonb,

  -- What one batch of this recipe produces, for scaling a target quantity.
  yield_qty integer not null default 1 check (yield_qty > 0),
  yield_unit text not null default 'each',

  -- Surfaced as a pinned, non-dismissible banner on the station.
  allergens text[] not null default '{}',

  notes text not null default '',
  active_from timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (menu_item_id, version)
);

create index recipes_item_idx on public.recipes (menu_item_id, version desc);
create index recipes_brand_idx on public.recipes (brand_id);

create type app.prep_status as enum ('pending', 'in_progress', 'done', 'abandoned');

create table public.prep_batches (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  location_id uuid not null references public.locations (id) on delete cascade,
  recipe_id uuid not null references public.recipes (id) on delete restrict,

  service_date date not null,
  target_qty integer not null check (target_qty > 0),
  produced_qty integer not null default 0 check (produced_qty >= 0),
  status app.prep_status not null default 'pending',

  assigned_to uuid references auth.users (id) on delete set null,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (location_id, service_date, recipe_id)
);

create index prep_batches_board_idx on public.prep_batches (location_id, service_date, status);
create index prep_batches_brand_idx on public.prep_batches (brand_id);

create trigger recipes_touch before update on public.recipes
  for each row execute function app.touch_updated_at();
create trigger prep_batches_touch before update on public.prep_batches
  for each row execute function app.touch_updated_at();

/**
 * Finishing a batch puts the item back on the menu.
 *
 * This is the one place the prep station reaches the guest: an item 86'd
 * because it ran out becomes orderable again the moment a tray of it is
 * marked done, on the kiosk and in the app, without anyone going to find the
 * 86 board. Only ever clears the flag -- completing a batch must not 86
 * anything.
 */
create or replace function app.prep_batch_clears_86() returns trigger
language plpgsql security definer set search_path = public, app as $$
begin
  if new.status = 'done' and coalesce(old.status, 'pending') <> 'done' then
    update public.menu_items mi
       set is_86d = false
      from public.recipes r
     where r.id = new.recipe_id
       and mi.id = r.menu_item_id
       and mi.is_86d;
  end if;
  return new;
end $$;

create trigger prep_batches_clear_86
  after update on public.prep_batches
  for each row execute function app.prep_batch_clears_86();

-- RLS ---------------------------------------------------------------------

alter table public.recipes enable row level security;
alter table public.prep_batches enable row level security;

-- Recipes are the brand's own intellectual property: staff and prep devices
-- read them, guests never do.
create policy recipes_select on public.recipes for select
  using (app.is_brand_staff(brand_id)
         or (app.device_is_active('prep') and brand_id = app.jwt_brand_id()));
create policy recipes_write on public.recipes for insert
  with check (app.is_brand_owner(brand_id));
create policy recipes_update on public.recipes for update
  using (app.is_brand_owner(brand_id)) with check (app.is_brand_owner(brand_id));
create policy recipes_delete on public.recipes for delete
  using (app.is_brand_owner(brand_id));

create policy prep_batches_select on public.prep_batches for select
  using (app.at_location(brand_id, location_id)
         or app.is_brand_owner(brand_id)
         or (app.device_is_active('prep') and location_id = app.jwt_device_location()));
create policy prep_batches_insert on public.prep_batches for insert
  with check (app.at_location(brand_id, location_id) or app.is_brand_owner(brand_id));
-- A prep device may move its own location's batches along and nothing else.
-- It has no policy on orders at all, so a tablet on a flour-covered bench
-- cannot refund anything.
create policy prep_batches_update on public.prep_batches for update
  using (app.at_location(brand_id, location_id)
         or app.is_brand_owner(brand_id)
         or (app.device_is_active('prep') and location_id = app.jwt_device_location()))
  with check (app.at_location(brand_id, location_id)
         or app.is_brand_owner(brand_id)
         or (app.device_is_active('prep') and location_id = app.jwt_device_location()));
create policy prep_batches_delete on public.prep_batches for delete
  using (app.is_brand_owner(brand_id));

grant select on public.recipes to authenticated;
grant select, insert, update on public.prep_batches to authenticated;
