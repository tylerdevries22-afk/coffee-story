-- Fix device-wall realtime channel authorization. Both realtime.messages
-- policies evaluate an EXISTS over public.device_installations as the
-- querying role, but the column grant to authenticated deliberately excludes
-- paired_device_id -- so evaluation raised "permission denied for table
-- device_installations" and channel authorization failed closed for every
-- principal. Move the check behind a security-definer helper so policy
-- evaluation no longer depends on the caller's column grants, keeping the
-- minimal identity-material grant intact. The tenant guard on installed_by
-- (20260902172957) is preserved verbatim inside the helper.

create or replace function app.device_wall_channel_allowed(p_topic text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.device_installations installation
    where p_topic = 'device-wall:' || installation.id::text
      and installation.archived_at is null and installation.revoked_at is null
      and (
        app.is_brand_owner(installation.brand_id)
        or (installation.installed_by = (select auth.uid())
            and app.is_brand_staff(installation.brand_id))
        or installation.paired_device_id = app.jwt_device_id()
      )
  )
$$;
revoke all on function app.device_wall_channel_allowed(text)
  from public, anon;
grant execute on function app.device_wall_channel_allowed(text)
  to authenticated, service_role;

drop policy device_wall_realtime_read on realtime.messages;
create policy device_wall_realtime_read on realtime.messages for select to authenticated using (
  app.device_wall_channel_allowed(realtime.topic())
);
drop policy device_wall_realtime_write on realtime.messages;
create policy device_wall_realtime_write on realtime.messages for insert to authenticated with check (
  app.device_wall_channel_allowed(realtime.topic())
);

alter function public.platform_release_readiness()
  rename to platform_release_readiness_20260902182602;
alter function public.platform_release_readiness_20260902182602() set schema app;
revoke all on function app.platform_release_readiness_20260902182602()
  from public, anon, authenticated;
grant execute on function app.platform_release_readiness_20260902182602() to service_role;

-- The 20260902172957 link asserts the realtime policy TEXT contains the
-- tenant guard, but this migration legitimately moves the guard inside the
-- helper, so the old text assertion can never match again and would strangle
-- the chain. Replace the archived body with the same checks pointed at the
-- guard's current enforcement point (same return value, so 20260902182602's
-- link assertion still holds).
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
  if not exists (
    select 1 from pg_catalog.pg_proc proc
    join pg_catalog.pg_namespace ns on ns.oid = proc.pronamespace
    where ns.nspname = 'app' and proc.proname = 'device_wall_channel_allowed'
      and proc.prosrc like '%is_brand_staff%' and proc.prosrc like '%installed_by%'
  ) then raise exception 'device wall channel helper lost its tenant guard'; end if;
  return '20260902172957';
end $$;
revoke all on function app.platform_release_readiness_20260902172957()
  from public, anon, authenticated;
grant execute on function app.platform_release_readiness_20260902172957() to service_role;

create or replace function public.platform_release_readiness()
returns text language plpgsql stable security invoker set search_path = '' as $$
begin
  if app.platform_release_readiness_20260902182602() <> '20260902182602' then
    raise exception 'readiness with_check repair prerequisite is incomplete';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_proc proc
    join pg_catalog.pg_namespace ns on ns.oid = proc.pronamespace
    where ns.nspname = 'app' and proc.proname = 'device_wall_channel_allowed'
      and proc.prosecdef
      and exists (
        select 1 from unnest(proc.proconfig) cfg where cfg like 'search_path=%'
      )
  ) then raise exception 'device wall channel helper missing or not definer-pinned'; end if;
  if (select count(*) from pg_catalog.pg_policies
      where schemaname = 'realtime' and tablename = 'messages'
        and policyname in ('device_wall_realtime_read', 'device_wall_realtime_write')
        and (coalesce(qual, '') || coalesce(with_check, ''))
            like '%app.device_wall_channel_allowed(realtime.topic())%'
  ) <> 2 then raise exception 'device wall realtime policies must delegate to the helper'; end if;
  return '20260902194106';
end $$;
revoke all on function public.platform_release_readiness() from public, anon, authenticated;
grant execute on function public.platform_release_readiness() to service_role;
