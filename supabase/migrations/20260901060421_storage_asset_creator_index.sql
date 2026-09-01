-- Cover the composite actor foreign key. This keeps employee removal and
-- integrity checks from scanning the growing asset library.
create index storage_assets_creator_brand_idx
  on public.storage_assets (created_by, brand_id);

alter function public.platform_release_readiness()
  rename to platform_release_readiness_20260901060005;
alter function public.platform_release_readiness_20260901060005() set schema app;
revoke all on function app.platform_release_readiness_20260901060005()
  from public, anon, authenticated;
grant execute on function app.platform_release_readiness_20260901060005()
  to service_role;

create or replace function public.platform_release_readiness()
returns text
language plpgsql stable security invoker set search_path = '' as $$
begin
  if app.platform_release_readiness_20260901060005() <> '20260901060005' then
    raise exception 'storage asset registry readiness prerequisite is incomplete';
  end if;
  if pg_catalog.to_regclass('public.storage_assets_creator_brand_idx') is null then
    raise exception 'storage asset creator foreign key is not indexed';
  end if;
  return '20260901060421';
end $$;

revoke all on function public.platform_release_readiness()
  from public, anon, authenticated;
grant execute on function public.platform_release_readiness()
  to service_role;
