-- Six SELECT policies carried a location_id column but gated only on
-- brand_id, so a location_manager or staff member at one store read every
-- row of every other store on the same brand -- exactly what rule 1's
-- `location_ids[]` claim exists to prevent. locations_update had the mirror
-- defect: `app.at_location` admits 'staff', so a barista could rewrite the
-- shop's public name, address, hours, and its square_connection_id pointer,
-- not just the fee columns that 20260722000039 already protects with a
-- trigger.
--
-- Each fix reuses the location helper its own file already trusts, so
-- nothing here introduces a new authorization idea:
--   * crew_tasks and workforce_role_assignments have a *nullable*
--     location_id (a brand-wide template task / role assignment has none).
--     app.at_location(brand_id, location_id) returns false on a null
--     location, which would hide those brand-wide rows from everyone but the
--     owner -- a regression, not a fix. 20260825000444 already solved this
--     exact shape for calendar_entries with a null-aware case (workforce
--     role assignments: app.calendar_row_visible directly; crew_tasks:
--     the same case inline, since crew_task_completions -- its sibling in
--     0025 -- has a NOT NULL location_id and so needs no case at all).
--   * site_module_overrides has a NOT NULL location_id and no in-file
--     sibling to copy from, so it takes the plain app.at_location scoping
--     every other mandatory-location table in the schema uses.
--   * connector_sync_runs, connector_health_snapshots and
--     connector_audit_events have a nullable location_id and were scoped by
--     app.is_brand_manager (brand_owner or location_manager, never staff) --
--     never by location at all. Their sibling connector_location_mappings
--     uses app.manages_location, which carries the same owner-or-manager
--     shape; a null-aware case keeps a brand-wide sync/health/audit row
--     visible to any manager of the brand, exactly as before, while a
--     location-tagged row is now scoped to the manager of that location.
--   * locations_update needs a role change, not a location fix: the brief
--     is "owner or the location's manager, never staff". app.manages_location
--     is precisely that predicate (it is what 20260825000444 built for
--     calendar_entries' owner-or-manager write gate), so it replaces
--     app.at_location outright rather than gaining a case.

drop policy crew_tasks_select on public.crew_tasks;
create policy crew_tasks_select on public.crew_tasks for select
  using (
    case
      when location_id is null then app.is_brand_staff(brand_id)
      else app.at_location(brand_id, location_id)
    end
  );

drop policy workforce_role_assignments_select on public.workforce_role_assignments;
create policy workforce_role_assignments_select on public.workforce_role_assignments
  for select to authenticated using (app.calendar_row_visible(brand_id, location_id));

drop policy site_module_overrides_select on public.site_module_overrides;
create policy site_module_overrides_select on public.site_module_overrides
  for select to authenticated using (app.at_location(brand_id, location_id));

drop policy connector_sync_runs_select on public.connector_sync_runs;
create policy connector_sync_runs_select on public.connector_sync_runs
  for select to authenticated using (
    case
      when location_id is null then app.is_brand_manager(brand_id)
      else app.manages_location(brand_id, location_id)
    end
  );

drop policy connector_health_snapshots_select on public.connector_health_snapshots;
create policy connector_health_snapshots_select on public.connector_health_snapshots
  for select to authenticated using (
    case
      when location_id is null then app.is_brand_manager(brand_id)
      else app.manages_location(brand_id, location_id)
    end
  );

drop policy connector_audit_events_select on public.connector_audit_events;
create policy connector_audit_events_select on public.connector_audit_events
  for select to authenticated using (
    case
      when location_id is null then app.is_brand_manager(brand_id)
      else app.manages_location(brand_id, location_id)
    end
  );

drop policy locations_update on public.locations;
create policy locations_update on public.locations for update
  using (app.manages_location(brand_id, id))
  with check (app.manages_location(brand_id, id));

-- Release assertion: fail if any of the seven policies above regresses to a
-- brand-only (or, for locations_update, staff-admitting) predicate. Reading
-- pg_policies.qual/with_check text is the same technique 20260902172957 and
-- 20260902144208 already use to pin a policy's authorization shape.
create or replace function app.assert_location_scoped_row_policies()
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  expectation record;
  failures text[] := array[]::text[];
begin
  for expectation in
    select * from (values
      ('crew_tasks', 'crew_tasks_select', 'at_location'),
      ('workforce_role_assignments', 'workforce_role_assignments_select', 'calendar_row_visible'),
      ('site_module_overrides', 'site_module_overrides_select', 'at_location'),
      ('connector_sync_runs', 'connector_sync_runs_select', 'manages_location'),
      ('connector_health_snapshots', 'connector_health_snapshots_select', 'manages_location'),
      ('connector_audit_events', 'connector_audit_events_select', 'manages_location'),
      ('locations', 'locations_update', 'manages_location')
    ) as expected(tablename, policyname, helper)
  loop
    if not exists (
      select 1 from pg_catalog.pg_policies policy
      where policy.schemaname = 'public'
        and policy.tablename = expectation.tablename
        and policy.policyname = expectation.policyname
        and (
          pg_catalog.strpos(coalesce(policy.qual, ''), expectation.helper) > 0
          or pg_catalog.strpos(coalesce(policy.with_check, ''), expectation.helper) > 0
        )
    ) then
      failures := array_append(failures, expectation.tablename || '.' || expectation.policyname);
    end if;
  end loop;

  -- manages_location's role check is 'location_manager' only, never 'staff';
  -- app.at_location's is 'location_manager' or 'staff'. A predicate that
  -- still mentions at_location would silently readmit staff to
  -- locations_update, so the substring check above is not enough here.
  if exists (
    select 1 from pg_catalog.pg_policies policy
    where policy.schemaname = 'public'
      and policy.tablename = 'locations'
      and policy.policyname = 'locations_update'
      and (
        pg_catalog.strpos(coalesce(policy.qual, ''), 'at_location') > 0
        or pg_catalog.strpos(coalesce(policy.with_check, ''), 'at_location') > 0
      )
  ) then
    failures := array_append(failures, 'locations.locations_update (still admits staff via at_location)');
  end if;

  if array_length(failures, 1) > 0 then
    raise exception 'location-row policies lost their location scope: %',
      array_to_string(failures, ', ');
  end if;
end
$$;

revoke all on function app.assert_location_scoped_row_policies()
  from public, anon, authenticated;
grant execute on function app.assert_location_scoped_row_policies() to service_role;

select app.register_release(
  '20260912050000',
  'six location-tagged tables and locations_update are scoped to the caller''s location_ids, not just their brand',
  'app.assert_location_scoped_row_policies()'::regprocedure
);
