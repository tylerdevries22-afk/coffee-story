-- Payload-free invalidation for the tenant kiosk flow.
--
-- Kiosks read the public brand_storefront view, while direct brands rows are
-- claim-gated. Publishing this narrow signal lets anonymous devices learn
-- that HQ changed the flow without broadcasting brand terms or config JSON.
create table if not exists public.brand_config_signals (
  brand_id uuid primary key references public.brands (id) on delete cascade,
  revision bigint not null default 1,
  changed_at timestamptz not null default now()
);

alter table public.brand_config_signals enable row level security;

drop policy if exists brand_config_signals_select on public.brand_config_signals;
create policy brand_config_signals_select on public.brand_config_signals
  for select to anon, authenticated using (true);

grant select on public.brand_config_signals to anon, authenticated;
revoke insert, update, delete on public.brand_config_signals from anon, authenticated;

create or replace function app.signal_brand_config_change() returns trigger
language plpgsql security definer set search_path = public, app as $$
begin
  if new.brand_config is not distinct from old.brand_config then
    return new;
  end if;
  insert into public.brand_config_signals (brand_id)
  values (new.id)
  on conflict (brand_id) do update
    set revision = brand_config_signals.revision + 1,
        changed_at = now();
  return new;
end
$$;

revoke execute on function app.signal_brand_config_change from public, anon, authenticated;

drop trigger if exists brands_signal_brand_config_change on public.brands;
create trigger brands_signal_brand_config_change
after update of brand_config on public.brands
for each row execute function app.signal_brand_config_change();

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public'
       and tablename = 'brand_config_signals'
  ) then
    alter publication supabase_realtime add table public.brand_config_signals;
  end if;
end
$$;
