-- Storage catalog: a first-class registry for every Coffee Story object.
--
-- Storage's own schema is deliberately read-only: objects are created and
-- removed through the Storage API, while this table records their product
-- meaning, tenancy, integrity metadata, and source association.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'content-files',
  'content-files',
  false,
  6291456,
  array[
    'application/pdf',
    'application/zip',
    'application/octet-stream',
    'application/postscript',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'image/jpeg',
    'image/png',
    'image/svg+xml',
    'image/vnd.adobe.photoshop',
    'image/webp',
    'text/csv',
    'text/plain'
  ]::text[]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Private files are limited to the tenant's managers. Public image buckets
-- retain their current policies because their URLs are already published to
-- customer and training experiences.
create policy storage_content_files_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'content-files'
    and app.is_brand_manager(((storage.foldername(name))[1])::uuid)
  );

create policy storage_content_files_write on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'content-files'
    and app.is_brand_manager(((storage.foldername(name))[1])::uuid)
  );

create table public.storage_assets (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  bucket_id text not null check (bucket_id in ('menu-images', 'brand-assets', 'training-media', 'content-files')),
  object_path text not null check (length(object_path) between 3 and 1024),
  original_filename text not null check (length(original_filename) between 1 and 255),
  asset_kind text not null check (asset_kind in ('menu_image', 'brand_image', 'training_media', 'document', 'design', 'attachment')),
  visibility text not null check (visibility in ('public', 'private')),
  source_type text not null default 'unassigned' check (source_type in ('menu_item', 'catalog_folder', 'catalog_resource', 'training_module', 'training_lesson', 'unassigned')),
  source_key text check (source_key is null or length(source_key) between 1 and 180),
  mime_type text not null check (length(mime_type) between 1 and 255),
  byte_size bigint not null check (byte_size between 1 and 6291456),
  checksum_sha256 text check (checksum_sha256 is null or checksum_sha256 ~ '^[0-9a-f]{64}$'),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_by uuid,
  created_at timestamptz not null default now(),
  foreign key (created_by, brand_id)
    references public.brand_users (id, brand_id) on delete set null (created_by),
  unique (bucket_id, object_path),
  check (
    (bucket_id = 'menu-images' and asset_kind = 'menu_image' and visibility = 'public')
    or (bucket_id = 'brand-assets' and asset_kind = 'brand_image' and visibility = 'public')
    or (bucket_id = 'training-media' and asset_kind = 'training_media' and visibility = 'public')
    or (bucket_id = 'content-files' and asset_kind in ('document', 'design', 'attachment') and visibility = 'private')
  )
);

create index storage_assets_brand_created_idx
  on public.storage_assets (brand_id, created_at desc);
create index storage_assets_brand_bucket_idx
  on public.storage_assets (brand_id, bucket_id, created_at desc);
create index storage_assets_source_idx
  on public.storage_assets (brand_id, source_type, source_key)
  where source_key is not null;

alter table public.storage_assets enable row level security;

create policy storage_assets_manager_read on public.storage_assets
  for select to authenticated
  using (app.is_brand_manager(brand_id));

revoke all on public.storage_assets from anon, authenticated;
grant select on public.storage_assets to authenticated;

-- The historical media ledger is the source of record for every object that
-- exists today. The join is read-only against storage.objects; no Storage
-- metadata is altered by this migration.
insert into public.storage_assets (
  brand_id, bucket_id, object_path, original_filename, asset_kind, visibility,
  source_type, source_key, mime_type, byte_size, checksum_sha256, metadata,
  created_by, created_at
)
select
  version.brand_id,
  object.bucket_id,
  version.object_path,
  regexp_replace(version.object_path, '^.*/', ''),
  case object.bucket_id
    when 'menu-images' then 'menu_image'
    when 'brand-assets' then 'brand_image'
    when 'training-media' then 'training_media'
  end,
  'public',
  version.entity_type,
  version.entity_key,
  coalesce(object.metadata ->> 'mimetype', version.mime_type, 'application/octet-stream'),
  coalesce(nullif(object.metadata ->> 'size', '')::bigint, version.byte_size, 1),
  version.checksum_sha256,
  jsonb_build_object('source', 'content_media_versions', 'mediaVersionId', version.id),
  version.created_by,
  version.created_at
from public.content_media_versions version
join storage.objects object
  on object.bucket_id = version.storage_bucket
 and object.name = version.object_path
where version.storage_bucket in ('menu-images', 'brand-assets', 'training-media')
  and version.object_path is not null
on conflict (bucket_id, object_path) do nothing;
