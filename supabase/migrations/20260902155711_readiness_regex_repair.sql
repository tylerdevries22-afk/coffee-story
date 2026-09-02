-- Repair the readiness head: the 20260902144208 spot assertion carried an
-- invalid regex (an unbalanced literal paren), so platform_release_readiness()
-- raised "invalid regular expression" instead of answering. The migration
-- itself applied; only calling the function fails.
--
-- The chain rule is that every later link calls its predecessor, so the
-- archived copy must be callable. This migration archives the broken head,
-- replaces the archived body with the corrected assertion (same checks, same
-- return value), and installs a new head on top.

alter function public.platform_release_readiness()
  rename to platform_release_readiness_20260902144208;
alter function public.platform_release_readiness_20260902144208() set schema app;

create or replace function app.platform_release_readiness_20260902144208()
returns text language plpgsql stable security invoker set search_path = '' as $$
begin
  if app.platform_release_readiness_20260902124238() <> '20260902124238' then
    raise exception 'foreign key index readiness prerequisite is incomplete';
  end if;
  if exists (
    select 1 from pg_catalog.pg_indexes
    where schemaname = 'public' and indexname = 'locations_id_brand_device_wall_idx'
  ) then raise exception 'duplicate locations index restored'; end if;
  if not exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'franchise_networks'
      and policyname = 'franchise_networks_select'
      and qual ~* '\(\s*select\s+auth\.uid\(\)'
  ) then raise exception 'franchise network policy lost its init-plan hoist'; end if;
  return '20260902144208';
end $$;
revoke all on function app.platform_release_readiness_20260902144208()
  from public, anon, authenticated;
grant execute on function app.platform_release_readiness_20260902144208() to service_role;

create or replace function public.platform_release_readiness()
returns text language plpgsql stable security invoker set search_path = '' as $$
begin
  if app.platform_release_readiness_20260902144208() <> '20260902144208' then
    raise exception 'policy advisor readiness prerequisite is incomplete';
  end if;
  return '20260902155711';
end $$;
revoke all on function public.platform_release_readiness() from public, anon, authenticated;
grant execute on function public.platform_release_readiness() to service_role;
