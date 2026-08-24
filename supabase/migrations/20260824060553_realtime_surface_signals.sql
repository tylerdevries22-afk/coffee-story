-- 0043: safe invalidation signals for surfaces that cannot read the source row.
--
-- A pickup display must never subscribe to orders: Postgres Changes sends the
-- whole row, including the customer id, cart snapshot, money and private note.
-- Likewise, publishing locations would send payment configuration that a
-- storefront only needs to know changed. These two narrow tables carry no
-- business payload. A signal makes the surface reconcile through its existing
-- RLS-gated read (`board_tickets` or `locations`).

-- Shifts used to join only auth.users' UUID through brand_users, leaving the
-- crew roster with no human-readable name it was permitted to display.
alter table public.brand_users
  add column display_name text not null default '';

create table public.board_change_signals (
  location_id uuid primary key references public.locations (id) on delete cascade,
  brand_id uuid not null references public.brands (id) on delete cascade,
  revision bigint not null default 1,
  changed_at timestamptz not null default now()
);

create table public.location_setting_signals (
  location_id uuid primary key references public.locations (id) on delete cascade,
  brand_id uuid not null references public.brands (id) on delete cascade,
  revision bigint not null default 1,
  changed_at timestamptz not null default now()
);

alter table public.board_change_signals enable row level security;
alter table public.location_setting_signals enable row level security;

-- Staff receive only their locations. A paired display receives only its own
-- signal and then still has to pass app.can_read_board inside board_tickets.
create policy board_change_signals_select on public.board_change_signals for select
  using (
    app.is_brand_owner(brand_id)
    or app.at_location(brand_id, location_id)
    or (
      app.device_is_active('display')
      and brand_id = app.jwt_brand_id()
      and location_id = app.jwt_device_location()
    )
  );

-- Storefront location rows are already publicly readable. Publishing only a
-- revision avoids broadcasting the row's operational configuration.
create policy location_setting_signals_select on public.location_setting_signals for select
  using (true);

grant select on public.board_change_signals to authenticated;
grant select on public.location_setting_signals to anon, authenticated;
revoke insert, update, delete on public.board_change_signals from anon, authenticated;
revoke insert, update, delete on public.location_setting_signals from anon, authenticated;

create or replace function app.signal_board_change() returns trigger
language plpgsql security definer set search_path = public, app as $$
declare
  source_location uuid := coalesce(new.location_id, old.location_id);
  source_brand uuid := coalesce(new.brand_id, old.brand_id);
begin
  insert into public.board_change_signals (location_id, brand_id)
  values (source_location, source_brand)
  on conflict (location_id) do update
    set brand_id = excluded.brand_id,
        revision = board_change_signals.revision + 1,
        changed_at = now();
  return coalesce(new, old);
end
$$;

create or replace function app.signal_location_setting_change() returns trigger
language plpgsql security definer set search_path = public, app as $$
begin
  -- Only guest-facing settings invalidate a running storefront.
  if new.ordering_paused is distinct from old.ordering_paused
     or new.hours is distinct from old.hours then
    insert into public.location_setting_signals (location_id, brand_id)
    values (new.id, new.brand_id)
    on conflict (location_id) do update
      set brand_id = excluded.brand_id,
          revision = location_setting_signals.revision + 1,
          changed_at = now();
  end if;
  return new;
end
$$;

revoke execute on function app.signal_board_change from public, anon, authenticated;
revoke execute on function app.signal_location_setting_change from public, anon, authenticated;

create trigger orders_signal_board_change
after insert or update or delete on public.orders
for each row execute function app.signal_board_change();

create trigger locations_signal_setting_change
after update on public.locations
for each row execute function app.signal_location_setting_change();

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public'
       and tablename = 'board_change_signals'
  ) then
    alter publication supabase_realtime add table public.board_change_signals;
  end if;

  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public'
       and tablename = 'location_setting_signals'
  ) then
    alter publication supabase_realtime add table public.location_setting_signals;
  end if;

  -- No surface subscribes to order_events. Keeping an unread private table in
  -- the publication creates drift between the schema and the subscriber set.
  if exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public'
       and tablename = 'order_events'
  ) then
    alter publication supabase_realtime drop table public.order_events;
  end if;
end
$$;
