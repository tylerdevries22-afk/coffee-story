-- Covering indexes for the device-wall and franchise/module foreign keys.
--
-- The hosted gate caught what PR-time verification cannot: the readiness
-- chain re-asserts FK coverage against the whole database at call time, and
-- both new migrations added foreign keys whose leading-index columns did not
-- match the key set. Postgres answers a parent delete by probing the child;
-- without a covering index that probe is a sequential scan per parent row.
--
-- Coverage test (20260830020000): an index covers a foreign key when the SET
-- of its leading N key columns equals the key's columns, in any order. Every
-- index below is named so the covered key reads straight off the name.

-- 20260902021857 (production device wall)
create index if not exists device_installations_installed_by_idx
  on public.device_installations (installed_by);
create index if not exists device_installations_paired_brand_location_idx
  on public.device_installations (paired_device_id, brand_id, location_id);

create index if not exists device_wall_layouts_user_id_idx
  on public.device_wall_layouts (user_id);
create index if not exists device_wall_layouts_location_brand_idx
  on public.device_wall_layouts (location_id, brand_id);

create index if not exists device_diagnostic_runs_installation_brand_location_idx
  on public.device_diagnostic_runs (installation_id, brand_id, location_id);
create index if not exists device_diagnostic_runs_requested_by_idx
  on public.device_diagnostic_runs (requested_by);

create index if not exists device_wall_enrollment_codes_installation_brand_location_idx
  on public.device_wall_enrollment_codes (installation_id, brand_id, location_id);
create index if not exists device_wall_enrollment_codes_paired_device_idx
  on public.device_wall_enrollment_codes (paired_device_id);
create index if not exists device_wall_enrollment_codes_created_by_idx
  on public.device_wall_enrollment_codes (created_by);

create index if not exists device_stream_sessions_installation_brand_location_idx
  on public.device_stream_sessions (installation_id, brand_id, location_id);
create index if not exists device_stream_sessions_viewer_id_idx
  on public.device_stream_sessions (viewer_id);

create index if not exists device_stream_audit_events_session_id_idx
  on public.device_stream_audit_events (session_id);
create index if not exists device_stream_audit_events_installation_brand_location_idx
  on public.device_stream_audit_events (installation_id, brand_id, location_id);
create index if not exists device_stream_audit_events_viewer_id_idx
  on public.device_stream_audit_events (viewer_id);

-- 20260902083817 (franchise module foundations)
create index if not exists franchise_memberships_user_id_idx
  on public.franchise_memberships (user_id);

create index if not exists franchise_network_brands_brand_id_idx
  on public.franchise_network_brands (brand_id);
create index if not exists franchise_network_brands_added_by_idx
  on public.franchise_network_brands (added_by);

create index if not exists module_installations_installed_by_idx
  on public.module_installations (installed_by);

create index if not exists module_installation_events_installation_idx
  on public.module_installation_events (installation_id, created_at desc);
create index if not exists module_installation_events_actor_idx
  on public.module_installation_events (actor);

create index if not exists site_module_overrides_brand_module_idx
  on public.site_module_overrides (brand_id, module_key);

create index if not exists delegated_access_grants_brand_id_idx
  on public.delegated_access_grants (brand_id);
create index if not exists delegated_access_grants_network_id_idx
  on public.delegated_access_grants (network_id);
create index if not exists delegated_access_grants_created_by_idx
  on public.delegated_access_grants (created_by);

-- The chain already re-checks FK coverage end to end: this link calls
-- 20260902083817, which calls 20260902021857, which reaches the coverage
-- assertion in 20260830020000. The spot assertions below pin the two indexes
-- the hosted gate actually named, so a future edit cannot drop them quietly.
alter function public.platform_release_readiness()
  rename to platform_release_readiness_20260902083817;
alter function public.platform_release_readiness_20260902083817() set schema app;
revoke all on function app.platform_release_readiness_20260902083817()
  from public, anon, authenticated;
grant execute on function app.platform_release_readiness_20260902083817() to service_role;

create or replace function public.platform_release_readiness()
returns text language plpgsql stable security invoker set search_path = '' as $$
begin
  if app.platform_release_readiness_20260902083817() <> '20260902083817' then
    raise exception 'franchise module readiness prerequisite is incomplete';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_indexes
    where schemaname = 'public' and indexname = 'delegated_access_grants_brand_id_idx'
  ) then raise exception 'delegated access brand foreign key is uncovered'; end if;
  if not exists (
    select 1 from pg_catalog.pg_indexes
    where schemaname = 'public' and indexname = 'device_stream_sessions_viewer_id_idx'
  ) then raise exception 'stream session viewer foreign key is uncovered'; end if;
  return '20260902124238';
end $$;
revoke all on function public.platform_release_readiness() from public, anon, authenticated;
grant execute on function public.platform_release_readiness() to service_role;
