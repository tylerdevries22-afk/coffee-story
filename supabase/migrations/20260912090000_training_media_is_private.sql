-- training-media was declared `public = true` in 20260826155933 alongside
-- menu-images and brand-assets, and storage_brand_read granted every one of
-- them a blanket `to public using (bucket_id in (...))` with no tenant
-- predicate. Menu photos and brand assets are meant to be public -- the
-- storefront renders them logged out. Internal staff training material is
-- not: brand_storefront already hands out brand ids to anyone, and Storage
-- serves a public bucket unauthenticated at /storage/v1/object/public/...
-- regardless of any RLS policy on storage.objects. The three write policies
-- (storage_brand_write/update/delete) already gate on
-- app.is_brand_staff(foldername(name)[1]) -- only the read side was wide
-- open. This migration narrows the read side to match and leaves every write
-- policy untouched.

update storage.buckets set public = false where id = 'training-media';

drop policy if exists storage_brand_read on storage.objects;

-- Menu imagery and brand assets keep the old unauthenticated read: the
-- customer app renders them logged out.
create policy storage_public_media_read on storage.objects for select
  to public
  using (bucket_id in ('menu-images', 'brand-assets'));

-- Training media now requires the same brand-staff membership its writers
-- already require.
create policy storage_training_media_read on storage.objects for select
  to authenticated
  using (
    bucket_id = 'training-media'
    and app.is_brand_staff(((storage.foldername(name))[1])::uuid));

-- storage_assets (20260901055504) hard-coded visibility = 'public' for every
-- training_media row via its own CHECK, which is the same mistake one layer
-- up: it is what apps/hq/lib/storage-library.ts and storage-data.ts read to
-- decide whether storageAssetDownload hands back a public URL or signs one.
-- Drop the old constraint before touching the data -- it still requires
-- 'public' for a training-media row until it is gone -- then backfill and
-- reinstate it with training-media on the private branch.
do $$
declare
  legacy_constraint text;
begin
  select conname into legacy_constraint
  from pg_catalog.pg_constraint
  where conrelid = 'public.storage_assets'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%training-media%training_media%public%';
  if legacy_constraint is not null then
    execute format('alter table public.storage_assets drop constraint %I', legacy_constraint);
  end if;
end $$;

update public.storage_assets set visibility = 'private' where bucket_id = 'training-media';

alter table public.storage_assets
  add constraint storage_assets_kind_matches_bucket_visibility
  check (
    (bucket_id = 'menu-images' and asset_kind = 'menu_image' and visibility = 'public')
    or (bucket_id = 'brand-assets' and asset_kind = 'brand_image' and visibility = 'public')
    or (bucket_id = 'training-media' and asset_kind = 'training_media' and visibility = 'private')
    or (bucket_id = 'content-files' and asset_kind in ('document', 'design', 'attachment') and visibility = 'private')
  );

create or replace function app.assert_training_media_is_private()
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if exists (select 1 from storage.buckets where id = 'training-media' and public) then
    raise exception 'training-media bucket must not be public';
  end if;
  if exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'storage_brand_read'
  ) then
    raise exception 'the old world-readable storage_brand_read policy still exists';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'storage_training_media_read'
      and coalesce(qual, '') like '%training-media%'
      and coalesce(qual, '') like '%is_brand_staff%'
  ) then
    raise exception 'training-media read policy must require brand-staff membership';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'storage_public_media_read'
      and coalesce(qual, '') like '%menu-images%'
      and coalesce(qual, '') not like '%training-media%'
  ) then
    raise exception 'menu-images and brand-assets must stay publicly readable';
  end if;
  if exists (
    select 1 from public.storage_assets where bucket_id = 'training-media' and visibility <> 'private'
  ) then
    raise exception 'training-media storage_assets rows must be marked private';
  end if;
end $$;

revoke all on function app.assert_training_media_is_private() from public, anon, authenticated;
grant execute on function app.assert_training_media_is_private() to service_role;

select app.register_release(
  '20260912090000',
  'training-media storage is private; reads require brand-staff membership',
  'app.assert_training_media_is_private()'::regprocedure
);
