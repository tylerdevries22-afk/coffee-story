-- Keep privileged operation implementations outside the exposed API schema.
-- Public RPCs remain stable, invoker-safe wrappers, while the implementation
-- continues to enforce tenant, membership, competency, and idempotency checks.
alter function public.acknowledge_operation_notification(uuid, uuid) set schema app;
alter function public.cancel_operation_occurrence(uuid, uuid, text) set schema app;
alter function public.claim_operation_occurrence(uuid, uuid) set schema app;
alter function public.complete_operation_occurrence(uuid, uuid, jsonb, text, jsonb) set schema app;
alter function public.create_manual_operation_occurrence(uuid, uuid, uuid, timestamptz, integer) set schema app;
alter function public.register_operation_device(uuid, text, text) set schema app;
alter function public.release_operation_occurrence(uuid, uuid) set schema app;
alter function public.report_operation_issue(uuid, uuid, text, text, text, text) set schema app;
alter function public.resolve_operation_issue(uuid, uuid, text) set schema app;
alter function public.unregister_operation_device(uuid, uuid) set schema app;
alter function public.update_operation_issue(uuid, uuid, text, text) set schema app;

revoke all on function app.acknowledge_operation_notification(uuid, uuid) from public, anon;
revoke all on function app.cancel_operation_occurrence(uuid, uuid, text) from public, anon;
revoke all on function app.claim_operation_occurrence(uuid, uuid) from public, anon;
revoke all on function app.complete_operation_occurrence(uuid, uuid, jsonb, text, jsonb) from public, anon;
revoke all on function app.create_manual_operation_occurrence(uuid, uuid, uuid, timestamptz, integer) from public, anon;
revoke all on function app.register_operation_device(uuid, text, text) from public, anon;
revoke all on function app.release_operation_occurrence(uuid, uuid) from public, anon;
revoke all on function app.report_operation_issue(uuid, uuid, text, text, text, text) from public, anon;
revoke all on function app.resolve_operation_issue(uuid, uuid, text) from public, anon;
revoke all on function app.unregister_operation_device(uuid, uuid) from public, anon;
revoke all on function app.update_operation_issue(uuid, uuid, text, text) from public, anon;

create function public.acknowledge_operation_notification(
  target_notification uuid,
  target_action_id uuid
) returns public.operation_operator_notifications
language sql security invoker set search_path = '' as $$
  select app.acknowledge_operation_notification(target_notification, target_action_id)
$$;

create function public.cancel_operation_occurrence(
  target_occurrence uuid,
  target_action_id uuid,
  target_reason text
) returns public.operation_occurrences
language sql security invoker set search_path = '' as $$
  select app.cancel_operation_occurrence(target_occurrence, target_action_id, target_reason)
$$;

create function public.claim_operation_occurrence(
  target_occurrence uuid,
  target_action_id uuid
) returns public.operation_occurrences
language sql security invoker set search_path = '' as $$
  select app.claim_operation_occurrence(target_occurrence, target_action_id)
$$;

create function public.complete_operation_occurrence(
  target_occurrence uuid,
  target_action_id uuid,
  target_responses jsonb,
  target_note text default '',
  target_issues jsonb default '[]'::jsonb
) returns public.operation_occurrences
language sql security invoker set search_path = '' as $$
  select app.complete_operation_occurrence(
    target_occurrence, target_action_id, target_responses, target_note, target_issues
  )
$$;

create function public.create_manual_operation_occurrence(
  target_location uuid,
  target_template uuid,
  target_action_id uuid,
  target_scheduled_for timestamptz default now(),
  target_due_window_minutes integer default 30
) returns public.operation_occurrences
language sql security invoker set search_path = '' as $$
  select app.create_manual_operation_occurrence(
    target_location, target_template, target_action_id,
    target_scheduled_for, target_due_window_minutes
  )
$$;

create function public.register_operation_device(
  target_action_id uuid,
  target_expo_push_token text,
  target_platform text
) returns public.operation_staff_devices
language sql security invoker set search_path = '' as $$
  select app.register_operation_device(target_action_id, target_expo_push_token, target_platform)
$$;

create function public.release_operation_occurrence(
  target_occurrence uuid,
  target_action_id uuid
) returns public.operation_occurrences
language sql security invoker set search_path = '' as $$
  select app.release_operation_occurrence(target_occurrence, target_action_id)
$$;

create function public.report_operation_issue(
  target_occurrence uuid,
  target_action_id uuid,
  target_category text,
  target_severity text,
  target_description text,
  target_step_key text default null
) returns public.operation_issues
language sql security invoker set search_path = '' as $$
  select app.report_operation_issue(
    target_occurrence, target_action_id, target_category,
    target_severity, target_description, target_step_key
  )
$$;

create function public.resolve_operation_issue(
  target_issue uuid,
  target_action_id uuid,
  target_resolution text
) returns public.operation_issues
language sql security invoker set search_path = '' as $$
  select app.resolve_operation_issue(target_issue, target_action_id, target_resolution)
$$;

create function public.unregister_operation_device(
  target_action_id uuid,
  target_device_id uuid
) returns public.operation_staff_devices
language sql security invoker set search_path = '' as $$
  select app.unregister_operation_device(target_action_id, target_device_id)
$$;

create function public.update_operation_issue(
  target_issue uuid,
  target_action_id uuid,
  target_status text,
  target_resolution text default ''
) returns public.operation_issues
language sql security invoker set search_path = '' as $$
  select app.update_operation_issue(
    target_issue, target_action_id, target_status, target_resolution
  )
$$;

revoke all on function public.acknowledge_operation_notification(uuid, uuid) from public, anon;
revoke all on function public.cancel_operation_occurrence(uuid, uuid, text) from public, anon;
revoke all on function public.claim_operation_occurrence(uuid, uuid) from public, anon;
revoke all on function public.complete_operation_occurrence(uuid, uuid, jsonb, text, jsonb) from public, anon;
revoke all on function public.create_manual_operation_occurrence(uuid, uuid, uuid, timestamptz, integer) from public, anon;
revoke all on function public.register_operation_device(uuid, text, text) from public, anon;
revoke all on function public.release_operation_occurrence(uuid, uuid) from public, anon;
revoke all on function public.report_operation_issue(uuid, uuid, text, text, text, text) from public, anon;
revoke all on function public.resolve_operation_issue(uuid, uuid, text) from public, anon;
revoke all on function public.unregister_operation_device(uuid, uuid) from public, anon;
revoke all on function public.update_operation_issue(uuid, uuid, text, text) from public, anon;

grant execute on function public.acknowledge_operation_notification(uuid, uuid) to authenticated;
grant execute on function public.cancel_operation_occurrence(uuid, uuid, text) to authenticated;
grant execute on function public.claim_operation_occurrence(uuid, uuid) to authenticated;
grant execute on function public.complete_operation_occurrence(uuid, uuid, jsonb, text, jsonb) to authenticated;
grant execute on function public.create_manual_operation_occurrence(uuid, uuid, uuid, timestamptz, integer) to authenticated;
grant execute on function public.register_operation_device(uuid, text, text) to authenticated;
grant execute on function public.release_operation_occurrence(uuid, uuid) to authenticated;
grant execute on function public.report_operation_issue(uuid, uuid, text, text, text, text) to authenticated;
grant execute on function public.resolve_operation_issue(uuid, uuid, text) to authenticated;
grant execute on function public.unregister_operation_device(uuid, uuid) to authenticated;
grant execute on function public.update_operation_issue(uuid, uuid, text, text) to authenticated;

-- FOR ALL also contributes a permissive SELECT policy. Split authoring rights
-- by command so staff reads evaluate one policy rather than two.
drop policy operation_templates_manage on public.operation_task_templates;
create policy operation_templates_manage_insert on public.operation_task_templates
  for insert to authenticated with check (app.brand_operations_enabled(brand_id) and (
    app.operation_brand_owner(brand_id)
    or (location_id is not null and app.operation_location_manager(brand_id, location_id))
  ));
create policy operation_templates_manage_update on public.operation_task_templates
  for update to authenticated
  using (app.brand_operations_enabled(brand_id) and (
    app.operation_brand_owner(brand_id)
    or (location_id is not null and app.operation_location_manager(brand_id, location_id))
  ))
  with check (app.brand_operations_enabled(brand_id) and (
    app.operation_brand_owner(brand_id)
    or (location_id is not null and app.operation_location_manager(brand_id, location_id))
  ));
create policy operation_templates_manage_delete on public.operation_task_templates
  for delete to authenticated using (app.brand_operations_enabled(brand_id) and (
    app.operation_brand_owner(brand_id)
    or (location_id is not null and app.operation_location_manager(brand_id, location_id))
  ));

drop policy operation_steps_manage on public.operation_task_steps;
create policy operation_steps_manage_insert on public.operation_task_steps
  for insert to authenticated with check (app.brand_operations_enabled(brand_id) and exists (
    select 1 from public.operation_task_templates template where template.id = template_id and (
      app.operation_brand_owner(template.brand_id)
      or (template.location_id is not null
        and app.operation_location_manager(template.brand_id, template.location_id))
    )
  ));
create policy operation_steps_manage_update on public.operation_task_steps
  for update to authenticated
  using (app.brand_operations_enabled(brand_id) and exists (
    select 1 from public.operation_task_templates template where template.id = template_id and (
      app.operation_brand_owner(template.brand_id)
      or (template.location_id is not null
        and app.operation_location_manager(template.brand_id, template.location_id))
    )
  ))
  with check (app.brand_operations_enabled(brand_id) and exists (
    select 1 from public.operation_task_templates template where template.id = template_id and (
      app.operation_brand_owner(template.brand_id)
      or (template.location_id is not null
        and app.operation_location_manager(template.brand_id, template.location_id))
    )
  ));
create policy operation_steps_manage_delete on public.operation_task_steps
  for delete to authenticated using (app.brand_operations_enabled(brand_id) and exists (
    select 1 from public.operation_task_templates template where template.id = template_id and (
      app.operation_brand_owner(template.brand_id)
      or (template.location_id is not null
        and app.operation_location_manager(template.brand_id, template.location_id))
    )
  ));

drop policy operation_schedules_manage on public.operation_schedules;
create policy operation_schedules_manage_insert on public.operation_schedules
  for insert to authenticated with check (app.operation_location_manager(brand_id, location_id));
create policy operation_schedules_manage_update on public.operation_schedules
  for update to authenticated using (app.operation_location_manager(brand_id, location_id))
  with check (app.operation_location_manager(brand_id, location_id));
create policy operation_schedules_manage_delete on public.operation_schedules
  for delete to authenticated using (app.operation_location_manager(brand_id, location_id));

drop policy operation_escalations_manage on public.operation_escalation_rules;
create policy operation_escalations_manage_insert on public.operation_escalation_rules
  for insert to authenticated with check (app.brand_operations_enabled(brand_id) and (
    (schedule_id is null and app.operation_brand_owner(brand_id)) or exists (
      select 1 from public.operation_schedules schedule where schedule.id = schedule_id
        and app.operation_location_manager(schedule.brand_id, schedule.location_id)
    )
  ));
create policy operation_escalations_manage_update on public.operation_escalation_rules
  for update to authenticated
  using (app.brand_operations_enabled(brand_id) and (
    (schedule_id is null and app.operation_brand_owner(brand_id)) or exists (
      select 1 from public.operation_schedules schedule where schedule.id = schedule_id
        and app.operation_location_manager(schedule.brand_id, schedule.location_id)
    )
  ))
  with check (app.brand_operations_enabled(brand_id) and (
    (schedule_id is null and app.operation_brand_owner(brand_id)) or exists (
      select 1 from public.operation_schedules schedule where schedule.id = schedule_id
        and app.operation_location_manager(schedule.brand_id, schedule.location_id)
    )
  ));
create policy operation_escalations_manage_delete on public.operation_escalation_rules
  for delete to authenticated using (app.brand_operations_enabled(brand_id) and (
    (schedule_id is null and app.operation_brand_owner(brand_id)) or exists (
      select 1 from public.operation_schedules schedule where schedule.id = schedule_id
        and app.operation_location_manager(schedule.brand_id, schedule.location_id)
    )
  ));

drop policy operation_retention_manage on public.operation_retention_policies;
create policy operation_retention_manage_insert on public.operation_retention_policies
  for insert to authenticated with check (app.operation_brand_owner(brand_id));
create policy operation_retention_manage_update on public.operation_retention_policies
  for update to authenticated using (app.operation_brand_owner(brand_id))
  with check (app.operation_brand_owner(brand_id));
create policy operation_retention_manage_delete on public.operation_retention_policies
  for delete to authenticated using (app.operation_brand_owner(brand_id));

drop policy training_competencies_manage on public.training_competencies;
create policy training_competencies_manage_insert on public.training_competencies
  for insert to authenticated with check (app.operation_brand_owner(brand_id));
create policy training_competencies_manage_update on public.training_competencies
  for update to authenticated using (app.operation_brand_owner(brand_id))
  with check (app.operation_brand_owner(brand_id));
create policy training_competencies_manage_delete on public.training_competencies
  for delete to authenticated using (app.operation_brand_owner(brand_id));

-- Preserve the previous consolidated contract as an internal prerequisite and
-- expose one new release marker that also certifies this hardening migration.
alter function public.platform_release_readiness() set schema app;
revoke all on function app.platform_release_readiness() from public, anon, authenticated;
grant execute on function app.platform_release_readiness() to service_role;

create function public.platform_release_readiness()
returns text
language plpgsql stable security invoker set search_path = '' as $$
declare public_wrapper_count integer;
begin
  if app.platform_release_readiness() <> '20260828095000' then
    raise exception 'prior consolidated release contract is missing';
  end if;

  select count(*) into public_wrapper_count
  from pg_catalog.pg_proc procedure
  join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'public'
    and procedure.proname = any (array[
      'acknowledge_operation_notification', 'cancel_operation_occurrence',
      'claim_operation_occurrence', 'complete_operation_occurrence',
      'create_manual_operation_occurrence', 'register_operation_device',
      'release_operation_occurrence', 'report_operation_issue',
      'resolve_operation_issue', 'unregister_operation_device',
      'update_operation_issue'
    ])
    and not procedure.prosecdef;
  if public_wrapper_count <> 11 then
    raise exception 'invoker-safe operation RPC boundary is incomplete';
  end if;

  if exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'public'
      and policyname = any (array[
        'operation_templates_manage', 'operation_steps_manage',
        'operation_schedules_manage', 'operation_escalations_manage',
        'operation_retention_manage', 'training_competencies_manage'
      ])
      and cmd = 'ALL'
  ) then
    raise exception 'operation authoring policies still duplicate read policies';
  end if;

  return '20260828104000';
end $$;

revoke all on function public.platform_release_readiness()
  from public, anon, authenticated;
grant execute on function public.platform_release_readiness()
  to service_role;
