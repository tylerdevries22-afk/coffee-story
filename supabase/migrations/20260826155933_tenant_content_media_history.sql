-- Immutable tenant media history for the HQ content workspace. Storefront
-- rows and training manifests keep the current public URL; this ledger keeps
-- every prior version so an owner can audit or restore it without overwriting
-- an object in place.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('menu-images', 'menu-images', true, 6291456,
    array['image/png', 'image/jpeg', 'image/webp', 'image/avif']::text[]),
  ('brand-assets', 'brand-assets', true, 10485760,
    array['image/png', 'image/jpeg', 'image/webp', 'image/avif', 'image/svg+xml']::text[]),
  ('training-media', 'training-media', true, 10485760,
    array['image/png', 'image/jpeg', 'image/webp', 'image/avif']::text[])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Rebuild the shared policies so every tenant-owned public-media bucket has
-- the same prefix isolation. Menu and training objects are append-only for
-- client roles: changing or deleting bytes would silently corrupt historical
-- versions. The service role can still perform an intentional retention job.
drop policy if exists storage_brand_read on storage.objects;
drop policy if exists storage_brand_write on storage.objects;
drop policy if exists storage_brand_update on storage.objects;
drop policy if exists storage_brand_delete on storage.objects;

create policy storage_brand_read on storage.objects for select
  to public
  using (bucket_id in ('menu-images', 'brand-assets', 'training-media'));

create policy storage_brand_write on storage.objects for insert
  to authenticated
  with check (
    bucket_id in ('menu-images', 'brand-assets', 'training-media')
    and app.is_brand_staff(((storage.foldername(name))[1])::uuid));

create policy storage_brand_update on storage.objects for update
  to authenticated
  using (
    bucket_id = 'brand-assets'
    and app.is_brand_staff(((storage.foldername(name))[1])::uuid))
  with check (
    bucket_id = 'brand-assets'
    and app.is_brand_staff(((storage.foldername(name))[1])::uuid));

create policy storage_brand_delete on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'brand-assets'
    and app.is_brand_staff(((storage.foldername(name))[1])::uuid));

create table public.content_media_versions (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  family text not null check (family in ('menu', 'training')),
  entity_type text not null check (
    entity_type in ('menu_item', 'training_module', 'training_lesson')
  ),
  entity_key text not null check (length(entity_key) between 1 and 180),
  slot text not null check (length(slot) between 1 and 80),
  public_url text not null check (
    length(public_url) between 12 and 2048 and public_url ~ '^https://'
  ),
  storage_bucket text check (
    storage_bucket is null or storage_bucket in ('menu-images', 'training-media')
  ),
  object_path text check (
    (storage_bucket is null and object_path is null)
    or (storage_bucket is not null and length(object_path) between 3 and 1024)
  ),
  mime_type text,
  byte_size bigint check (byte_size is null or byte_size between 1 and 10485760),
  checksum_sha256 text check (
    checksum_sha256 is null or checksum_sha256 ~ '^[0-9a-f]{64}$'
  ),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_by uuid,
  created_at timestamptz not null default now(),
  foreign key (created_by, brand_id)
    references public.brand_users (id, brand_id) on delete set null (created_by),
  check (
    (family = 'menu' and entity_type = 'menu_item')
    or (family = 'training' and entity_type in ('training_module', 'training_lesson'))
  ),
  unique (brand_id, entity_type, entity_key, slot, public_url)
);

create index content_media_versions_entity_idx
  on public.content_media_versions (
    brand_id, entity_type, entity_key, slot, created_at desc
  );
create index content_media_versions_created_by_idx
  on public.content_media_versions (created_by) where created_by is not null;

alter table public.content_media_versions enable row level security;

create policy content_media_versions_select on public.content_media_versions
  for select to authenticated
  using (app.is_brand_owner(brand_id));

revoke all on public.content_media_versions from anon, authenticated;
grant select on public.content_media_versions to authenticated;

-- Existing current menu pictures become revision zero. Their object location
-- is intentionally left null because external HTTPS images may not belong to
-- this project's Storage service.
insert into public.content_media_versions (
  brand_id, family, entity_type, entity_key, slot, public_url, metadata
)
select
  item.brand_id,
  'menu',
  'menu_item',
  item.id::text,
  'thumbnail',
  item.image_url,
  jsonb_build_object('source', 'migration')
from public.menu_items item
where item.image_url is not null and item.image_url ~ '^https://'
on conflict do nothing;

create or replace function app.capture_menu_thumbnail_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  editor uuid;
begin
  if new.image_url is null
     or new.image_url !~ '^https://'
     or (tg_op = 'UPDATE' and new.image_url is not distinct from old.image_url) then
    return new;
  end if;
  select member.id into editor
  from public.brand_users member
  where member.brand_id = new.brand_id
    and member.user_id = (select auth.uid())
  limit 1;
  insert into public.content_media_versions (
    brand_id, family, entity_type, entity_key, slot, public_url, created_by,
    storage_bucket, object_path
  ) values (
    new.brand_id, 'menu', 'menu_item', new.id::text, 'thumbnail', new.image_url, editor,
    case when position('/storage/v1/object/public/menu-images/' in new.image_url) > 0 then 'menu-images' end,
    case when position('/storage/v1/object/public/menu-images/' in new.image_url) > 0
      then split_part(new.image_url, '/storage/v1/object/public/menu-images/', 2) end
  ) on conflict do nothing;
  return new;
end $$;

revoke all on function app.capture_menu_thumbnail_version() from public;

create trigger menu_items_capture_thumbnail
after insert or update of image_url on public.menu_items
for each row execute function app.capture_menu_thumbnail_version();

create or replace function app.capture_training_media_versions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  editor uuid;
begin
  if tg_op = 'UPDATE' and new.manifest is not distinct from old.manifest then return new; end if;

  select member.id into editor
  from public.brand_users member
  where member.brand_id = new.brand_id
    and member.user_id = (select auth.uid())
  limit 1;

  insert into public.content_media_versions (
    brand_id, family, entity_type, entity_key, slot, public_url, created_by,
    storage_bucket, object_path, metadata
  )
  select
    new.brand_id,
    'training',
    'training_module',
    module.value ->> 'slug',
    'icon',
    module.value -> 'icon' ->> 'url',
    coalesce(new.updated_by, editor),
    case when position('/storage/v1/object/public/training-media/' in (module.value -> 'icon' ->> 'url')) > 0 then 'training-media' end,
    case when position('/storage/v1/object/public/training-media/' in (module.value -> 'icon' ->> 'url')) > 0
      then split_part(module.value -> 'icon' ->> 'url', '/storage/v1/object/public/training-media/', 2) end,
    jsonb_build_object('releaseId', new.id, 'version', new.version)
  from jsonb_array_elements(coalesce(new.manifest -> 'modules', '[]'::jsonb)) module
  where module.value -> 'icon' ->> 'url' ~ '^https://'
  on conflict do nothing;

  insert into public.content_media_versions (
    brand_id, family, entity_type, entity_key, slot, public_url, created_by,
    storage_bucket, object_path, metadata
  )
  select
    new.brand_id,
    'training',
    'training_lesson',
    concat(module.value ->> 'slug', '/', lesson.value ->> 'slug'),
    concat('lesson-media:', media.ordinality),
    media.value ->> 'url',
    coalesce(new.updated_by, editor),
    case when position('/storage/v1/object/public/training-media/' in (media.value ->> 'url')) > 0 then 'training-media' end,
    case when position('/storage/v1/object/public/training-media/' in (media.value ->> 'url')) > 0
      then split_part(media.value ->> 'url', '/storage/v1/object/public/training-media/', 2) end,
    jsonb_build_object(
      'releaseId', new.id,
      'version', new.version,
      'kind', media.value ->> 'kind',
      'title', media.value ->> 'title'
    )
  from jsonb_array_elements(coalesce(new.manifest -> 'modules', '[]'::jsonb)) module
  cross join lateral jsonb_array_elements(coalesce(module.value -> 'lessons', '[]'::jsonb)) lesson
  cross join lateral jsonb_array_elements(coalesce(lesson.value -> 'media', '[]'::jsonb))
    with ordinality media(value, ordinality)
  where media.value ->> 'url' ~ '^https://'
  on conflict do nothing;

  return new;
end $$;

revoke all on function app.capture_training_media_versions() from public;

create trigger training_releases_capture_media
after insert or update of manifest on public.training_releases
for each row execute function app.capture_training_media_versions();

insert into public.content_media_versions (
  brand_id, family, entity_type, entity_key, slot, public_url, created_by, metadata
)
select
  release.brand_id,
  'training',
  'training_module',
  module.value ->> 'slug',
  'icon',
  module.value -> 'icon' ->> 'url',
  release.updated_by,
  jsonb_build_object('releaseId', release.id, 'version', release.version, 'source', 'migration')
from public.training_releases release
cross join lateral jsonb_array_elements(coalesce(release.manifest -> 'modules', '[]'::jsonb)) module
where module.value -> 'icon' ->> 'url' ~ '^https://'
on conflict do nothing;

insert into public.content_media_versions (
  brand_id, family, entity_type, entity_key, slot, public_url, created_by, metadata
)
select
  release.brand_id,
  'training',
  'training_lesson',
  concat(module.value ->> 'slug', '/', lesson.value ->> 'slug'),
  concat('lesson-media:', media.ordinality),
  media.value ->> 'url',
  release.updated_by,
  jsonb_build_object(
    'releaseId', release.id,
    'version', release.version,
    'kind', media.value ->> 'kind',
    'title', media.value ->> 'title',
    'source', 'migration'
  )
from public.training_releases release
cross join lateral jsonb_array_elements(coalesce(release.manifest -> 'modules', '[]'::jsonb)) module
cross join lateral jsonb_array_elements(coalesce(module.value -> 'lessons', '[]'::jsonb)) lesson
cross join lateral jsonb_array_elements(coalesce(lesson.value -> 'media', '[]'::jsonb))
  with ordinality media(value, ordinality)
where media.value ->> 'url' ~ '^https://'
on conflict do nothing;

-- The readiness probe prevents a deployment from serving the new HQ editor
-- against a database that lacks its history ledger or training bucket.
create or replace function public.platform_release_readiness()
returns text
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = 'commit_order'
      and procedure.pronargs = 18
  ) then
    raise exception 'required order commit contract is missing';
  end if;
  if not exists (
    select 1
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = 'publish_manual_training_release'
      and procedure.pronargs = 4
  ) then
    raise exception 'required HQ training publication contract is missing';
  end if;
  if to_regclass('public.content_media_versions') is null then
    raise exception 'required content media history is missing';
  end if;
  if not exists (select 1 from storage.buckets where id = 'training-media') then
    raise exception 'required training media bucket is missing';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'orders'
  ) or not exists (
    select 1 from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'board_change_signals'
  ) then
    raise exception 'required order realtime publication is missing';
  end if;
  return '20260826155933';
end $$;
