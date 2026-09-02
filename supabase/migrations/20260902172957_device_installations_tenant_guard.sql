-- Tenant-guard the device-wall installed_by clauses. The select policy on
-- public.device_installations and both realtime.messages policies treated
-- installed_by alone as authority, so a user recorded as the installer could
-- read rows (or join channels) for a brand they do not belong to. The hosted
-- device-wall RLS suite caught a brand owner seeing a foreign tenant's
-- installation. installed_by must be scoped to brands the user is staff of.

drop policy device_installations_status_read on public.device_installations;
create policy device_installations_status_read on public.device_installations for select using (
  app.is_brand_owner(brand_id)
  or (app.jwt_role() = 'location_manager' and app.at_location(brand_id, location_id))
  or (installed_by = (select auth.uid()) and app.is_brand_staff(brand_id))
  or paired_device_id = app.jwt_device_id()
);

drop policy device_wall_realtime_read on realtime.messages;
create policy device_wall_realtime_read on realtime.messages for select to authenticated using (
  exists (
    select 1 from public.device_installations installation
    where realtime.topic() = 'device-wall:' || installation.id::text
      and installation.archived_at is null and installation.revoked_at is null
      and (
        app.is_brand_owner(installation.brand_id)
        or (installation.installed_by = (select auth.uid())
            and app.is_brand_staff(installation.brand_id))
        or installation.paired_device_id = app.jwt_device_id()
      )
  )
);
drop policy device_wall_realtime_write on realtime.messages;
create policy device_wall_realtime_write on realtime.messages for insert to authenticated with check (
  exists (
    select 1 from public.device_installations installation
    where realtime.topic() = 'device-wall:' || installation.id::text
      and installation.archived_at is null and installation.revoked_at is null
      and (
        app.is_brand_owner(installation.brand_id)
        or (installation.installed_by = (select auth.uid())
            and app.is_brand_staff(installation.brand_id))
        or installation.paired_device_id = app.jwt_device_id()
      )
  )
);

alter function public.platform_release_readiness()
  rename to platform_release_readiness_20260902155711;
alter function public.platform_release_readiness_20260902155711() set schema app;
revoke all on function app.platform_release_readiness_20260902155711()
  from public, anon, authenticated;
grant execute on function app.platform_release_readiness_20260902155711() to service_role;

create or replace function public.platform_release_readiness()
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
        and (coalesce(qual, '') || coalesce(check_qual, '')) like '%is_brand_staff%'
  ) <> 2 then raise exception 'device wall realtime policies lost their tenant guard'; end if;
  return '20260902172957';
end $$;
revoke all on function public.platform_release_readiness() from public, anon, authenticated;
grant execute on function public.platform_release_readiness() to service_role;
