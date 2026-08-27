-- Realtime receives only a release boundary. The curriculum answer key remains
-- server-only and is never included in a Postgres Changes payload.

create table if not exists public.training_release_events (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  release_id uuid not null,
  version integer not null check (version > 0),
  event_type text not null default 'published' check (event_type = 'published'),
  published_at timestamptz not null,
  created_at timestamptz not null default now(),
  foreign key (release_id, brand_id)
    references public.training_releases (id, brand_id) on delete cascade,
  unique (brand_id, release_id)
);

create index if not exists training_release_events_brand_idx
  on public.training_release_events (brand_id, created_at desc);

alter table public.training_release_events enable row level security;
drop policy if exists training_release_events_select on public.training_release_events;
create policy training_release_events_select on public.training_release_events
  for select to authenticated using (app.is_brand_staff(brand_id));

revoke all on table public.training_release_events from anon, authenticated;
grant select on table public.training_release_events to authenticated;
grant all on table public.training_release_events to service_role;

create or replace function app.capture_training_release_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'published'
     and (tg_op = 'INSERT' or old.status is distinct from 'published') then
    insert into public.training_release_events (
      brand_id, release_id, version, event_type, published_at
    ) values (
      new.brand_id, new.id, new.version, 'published', coalesce(new.published_at, now())
    ) on conflict (brand_id, release_id) do nothing;
  end if;
  return new;
end
$$;

revoke all on function app.capture_training_release_event() from public, anon, authenticated;
drop trigger if exists training_releases_sync_signal on public.training_releases;
create trigger training_releases_sync_signal
  after insert or update of status on public.training_releases
  for each row execute function app.capture_training_release_event();

insert into public.training_release_events (brand_id, release_id, version, event_type, published_at)
select brand_id, id, version, 'published', coalesce(published_at, now())
from public.training_releases
where status = 'published'
on conflict (brand_id, release_id) do nothing;

do $$
begin
  if exists (
    select 1 from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'training_releases'
  ) then
    alter publication supabase_realtime drop table public.training_releases;
  end if;
  if not exists (
    select 1 from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'training_release_events'
  ) then
    alter publication supabase_realtime add table public.training_release_events;
  end if;
end
$$;

comment on table public.training_release_events is
  'Tenant-scoped release boundary for realtime clients; never carries curriculum answer keys.';
