-- Repair the 20260902172957 readiness head: its realtime spot assertion
-- referenced pg_policies.check_qual, which does not exist (an INSERT policy's
-- WITH CHECK expression is exposed as with_check). The migration applied
-- clean; only calling platform_release_readiness() fails -- the same failure
-- class as the invalid regex repaired in 20260902155711. The policy fix
-- itself is correct and is unchanged here.
--
-- The chain rule is that every later link calls its predecessor, so the
-- archived copy must be callable. This migration archives the broken head,
-- replaces the archived body with the corrected assertion (same checks, same
-- return value), and installs a new head on top.

alter function public.platform_release_readiness()
  rename to platform_release_readiness_20260902172957;
alter function public.platform_release_readiness_20260902172957() set schema app;

create or replace function app.platform_release_readiness_20260902172957()
returns text language plpgsql stable security invoker set search_path = '' as $$
begin
  if app.platform_release_readiness_20260902155711() <> '20260902155711' then
    raise exception 'readiness regex repair prerequisite is incomplete';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'device_installations'
      and policyname = 'device_installations_status_read'
      and coalesce(qual, '') like '%is_brand_staff%'
  ) then raise exception 'device installations policy lost its tenant guard'; end if;
  if (select count(*) from pg_catalog.pg_policies
      where schemaname = 'realtime' and tablename = 'messages'
        and policyname in ('device_wall_realtime_read', 'device_wall_realtime_write')
        and (coalesce(qual, '') || coalesce(with_check, '')) like '%is_brand_staff%'
  ) <> 2 then raise exception 'device wall realtime policies lost their tenant guard'; end if;
  return '20260902172957';
end $$;
revoke all on function app.platform_release_readiness_20260902172957()
  from public, anon, authenticated;
grant execute on function app.platform_release_readiness_20260902172957() to service_role;

create or replace function public.platform_release_readiness()
returns text language plpgsql stable security invoker set search_path = '' as $$
begin
  if app.platform_release_readiness_20260902172957() <> '20260902172957' then
    raise exception 'device installations tenant guard prerequisite is incomplete';
  end if;
  return '20260902182602';
end $$;
revoke all on function public.platform_release_readiness() from public, anon, authenticated;
grant execute on function public.platform_release_readiness() to service_role;
