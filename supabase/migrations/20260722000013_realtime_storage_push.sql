-- 0013: the plumbing three documented features silently lacked.
--
-- 1. Realtime. The customer tracking screen subscribes to order_events
--    INSERTs and the operator board to orders changes -- but no table was
--    ever added to the supabase_realtime publication, so both channels would
--    connect and never fire. replica identity full puts the changed row's
--    columns in the payload so location/order filters can match.
alter table public.orders replica identity full;
alter table public.order_events replica identity full;
alter publication supabase_realtime add table public.orders;
alter publication supabase_realtime add table public.order_events;

-- 2. Push tokens. customers.push_token was one device per guest with no
--    platform, no freshness, no revocation. Tokens are device-scoped rows;
--    the column stays (deprecated) until the apps stop reading it.
--    Written through the engine (service role); no client policies.
create table public.push_tokens (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  customer_id uuid not null references public.customers (id) on delete cascade,
  token text not null unique,
  platform text not null default 'unknown'
    check (platform in ('ios', 'android', 'web', 'unknown')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.push_tokens enable row level security;

create index push_tokens_customer_idx on public.push_tokens (customer_id);

create trigger push_tokens_touch before update on public.push_tokens
  for each row execute function app.touch_updated_at();

-- 3. Storage. menu_items.image_url and drops.hero_asset_url had no bucket to
--    point at and no upload path. Public read (they are storefront imagery);
--    writes are brand-staff scoped to a {brand_id}/ prefix so one brand can
--    never overwrite another's assets.
insert into storage.buckets (id, name, public)
values ('menu-images', 'menu-images', true), ('brand-assets', 'brand-assets', true)
on conflict (id) do nothing;

create policy storage_brand_read on storage.objects for select
  using (bucket_id in ('menu-images', 'brand-assets'));

create policy storage_brand_write on storage.objects for insert
  with check (
    bucket_id in ('menu-images', 'brand-assets')
    and app.is_brand_staff(((storage.foldername(name))[1])::uuid));

create policy storage_brand_update on storage.objects for update
  using (
    bucket_id in ('menu-images', 'brand-assets')
    and app.is_brand_staff(((storage.foldername(name))[1])::uuid));

create policy storage_brand_delete on storage.objects for delete
  using (
    bucket_id in ('menu-images', 'brand-assets')
    and app.is_brand_staff(((storage.foldername(name))[1])::uuid));
