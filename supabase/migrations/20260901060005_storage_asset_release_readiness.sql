-- Make the asset library part of the fail-closed deployment contract. The
-- preceding migration adds the bucket and registry; this link proves they
-- remain aligned before HQ advertises its storage UI as healthy.
alter function public.platform_release_readiness()
  rename to platform_release_readiness_20260831171620;
alter function public.platform_release_readiness_20260831171620() set schema app;
revoke all on function app.platform_release_readiness_20260831171620()
  from public, anon, authenticated;
grant execute on function app.platform_release_readiness_20260831171620()
  to service_role;

create or replace function public.platform_release_readiness()
returns text
language plpgsql stable security invoker set search_path = '' as $$
begin
  if app.platform_release_readiness_20260831171620() <> '20260831171620' then
    raise exception 'storage asset readiness prerequisite is incomplete';
  end if;
  if not exists (
    select 1 from storage.buckets
    where id = 'content-files' and public = false and file_size_limit = 6291456
  ) then
    raise exception 'private content-files bucket is not configured';
  end if;
  if pg_catalog.to_regclass('public.storage_assets') is null or not exists (
    select 1 from pg_catalog.pg_class where oid = 'public.storage_assets'::regclass and relrowsecurity
  ) then
    raise exception 'storage asset registry is not protected by RLS';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'storage_assets'
      and policyname = 'storage_assets_manager_read'
  ) then
    raise exception 'storage asset registry has no manager read policy';
  end if;
  if exists (
    select 1
    from storage.objects object
    where object.bucket_id in ('menu-images', 'training-media', 'brand-assets', 'content-files')
      and not exists (
        select 1 from public.storage_assets asset
        where asset.bucket_id = object.bucket_id and asset.object_path = object.name
      )
  ) then
    raise exception 'one or more storage objects are missing a registry record';
  end if;
  return '20260901060005';
end $$;

revoke all on function public.platform_release_readiness()
  from public, anon, authenticated;
grant execute on function public.platform_release_readiness()
  to service_role;
