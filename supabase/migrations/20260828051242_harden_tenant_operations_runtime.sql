-- Production hardening for the generic tenant operations runtime. This is
-- forward-only because the foundation may already exist on a preview stack.

create or replace function app.brand_operations_enabled(target_brand uuid)
returns boolean language sql stable set search_path = '' as $$
  select coalesce((select brand.operations from public.brands brand where brand.id = target_brand), false)
$$;
revoke all on function app.brand_operations_enabled(uuid) from public, anon;
grant execute on function app.brand_operations_enabled(uuid) to authenticated, service_role;

-- Operations authorization reads the current membership row instead of
-- trusting potentially stale custom JWT claims after a transfer or offboard.
create or replace function app.operation_location_access(
  target_brand uuid,
  target_location uuid
) returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(app.is_platform_admin() or exists (
    select 1 from public.brand_users member
    join public.brands brand on brand.id = member.brand_id and brand.operations
    where member.brand_id = target_brand and member.user_id = (select auth.uid())
      and (member.role = 'brand_owner' or target_location = any(member.location_ids))
  ), false)
$$;
revoke all on function app.operation_location_access(uuid, uuid) from public, anon;
grant execute on function app.operation_location_access(uuid, uuid) to authenticated, service_role;

create or replace function app.operation_location_manager(
  target_brand uuid,
  target_location uuid
) returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(app.is_platform_admin() or exists (
    select 1 from public.brand_users member
    join public.brands brand on brand.id = member.brand_id and brand.operations
    where member.brand_id = target_brand and member.user_id = (select auth.uid())
      and (member.role = 'brand_owner'
        or (member.role = 'location_manager' and target_location = any(member.location_ids)))
  ), false)
$$;
revoke all on function app.operation_location_manager(uuid, uuid) from public, anon;
grant execute on function app.operation_location_manager(uuid, uuid) to authenticated, service_role;

create or replace function app.operation_brand_owner(target_brand uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(app.is_platform_admin() or exists (
    select 1 from public.brand_users member
    join public.brands brand on brand.id = member.brand_id and brand.operations
    where member.brand_id = target_brand and member.user_id = (select auth.uid())
      and member.role = 'brand_owner'
  ), false)
$$;
revoke all on function app.operation_brand_owner(uuid) from public, anon;
grant execute on function app.operation_brand_owner(uuid) to authenticated, service_role;

create or replace function app.operation_brand_staff(target_brand uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(app.is_platform_admin() or exists (
    select 1 from public.brand_users member
    join public.brands brand on brand.id = member.brand_id and brand.operations
    where member.brand_id = target_brand and member.user_id = (select auth.uid())
  ), false)
$$;
revoke all on function app.operation_brand_staff(uuid) from public, anon;
grant execute on function app.operation_brand_staff(uuid) to authenticated, service_role;

create or replace function app.operation_manager_can_view_member(
  target_brand uuid,
  target_member uuid
) returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(app.is_platform_admin() or exists (
    select 1 from public.brand_users viewer
    join public.brand_users subject on subject.brand_id = viewer.brand_id
      and subject.id = target_member
    join public.brands brand on brand.id = viewer.brand_id and brand.operations
    where viewer.brand_id = target_brand and viewer.user_id = (select auth.uid())
      and (viewer.role = 'brand_owner'
        or (viewer.role = 'location_manager' and viewer.location_ids && subject.location_ids))
  ), false)
$$;
revoke all on function app.operation_manager_can_view_member(uuid, uuid) from public, anon;
grant execute on function app.operation_manager_can_view_member(uuid, uuid)
  to authenticated, service_role;

alter table public.operation_occurrences
  add column grace_minutes smallint not null default 0
    check (grace_minutes between 0 and 1440),
  add column claim_expires_at timestamptz,
  add constraint operation_occurrences_id_brand_location_key
    unique (id, brand_id, location_id);

alter table public.operation_task_templates
  add column managed_by_config boolean not null default false;

alter table public.workforce_roles
  add column managed_by_operations_config boolean not null default false;
alter table public.training_competencies
  add column managed_by_config boolean not null default false;

alter table public.operation_schedules
  add column schedule_key text,
  add column schedule_kind text not null default 'fixed_time'
    check (schedule_kind in ('fixed_time', 'opening_offset', 'closing_offset', 'open_interval')),
  add column anchor_offset_minutes smallint,
  add column interval_minutes smallint,
  add column interval_end_offset_minutes smallint,
  add column weekdays smallint[] not null default '{1,2,3,4,5,6,7}',
  add column managed_by_config boolean not null default false,
  add constraint operation_schedules_weekdays_check check (
    cardinality(weekdays) between 1 and 7
    and weekdays <@ array[1,2,3,4,5,6,7]::smallint[]
  );
update public.operation_schedules set schedule_key = 'legacy-' || replace(id::text, '-', '')
  where schedule_key is null;
alter table public.operation_schedules
  alter column local_start_time drop not null,
  alter column schedule_key set not null,
  add constraint operation_schedules_key_check
    check (schedule_key ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  add constraint operation_schedules_brand_location_key unique (brand_id, location_id, schedule_key),
  add constraint operation_schedules_rule_shape_check check (
    (schedule_kind = 'fixed_time' and local_start_time is not null
      and anchor_offset_minutes is null and interval_minutes is null
      and interval_end_offset_minutes is null)
    or (schedule_kind in ('opening_offset', 'closing_offset') and local_start_time is null
      and anchor_offset_minutes between -1440 and 1440 and interval_minutes is null
      and interval_end_offset_minutes is null)
    or (schedule_kind = 'open_interval' and local_start_time is null
      and anchor_offset_minutes between -1440 and 1440
      and interval_minutes between 15 and 1440
      and interval_end_offset_minutes between -1440 and 1440)
  );

alter table public.operation_escalation_rules
  add constraint operation_escalation_rules_id_brand_key unique (id, brand_id),
  add column is_active boolean not null default true,
  add column managed_by_config boolean not null default false,
  add constraint operation_escalation_channels_check check (
    cardinality(channels) between 1 and 2
    and channels <@ array['in_app', 'push']::text[]
  );

alter table public.operation_issues
  add column step_key text,
  alter column reported_by drop not null,
  drop constraint operation_issues_occurrence_id_brand_id_fkey,
  drop constraint operation_issues_reported_by_brand_id_fkey,
  add constraint operation_issues_occurrence_brand_location_fkey
    foreign key (occurrence_id, brand_id, location_id)
    references public.operation_occurrences (id, brand_id, location_id) on delete restrict,
  add constraint operation_issues_reported_by_brand_fkey
    foreign key (reported_by, brand_id)
    references public.brand_users (id, brand_id) on delete set null (reported_by);

alter table public.operation_notification_outbox
  drop constraint operation_notification_outbox_escalation_rule_id_fkey,
  drop constraint operation_notification_outbox_occurrence_id_brand_id_fkey,
  add constraint operation_outbox_escalation_brand_fkey
    foreign key (escalation_rule_id, brand_id)
    references public.operation_escalation_rules (id, brand_id) on delete restrict,
  add constraint operation_outbox_occurrence_brand_location_fkey
    foreign key (occurrence_id, brand_id, location_id)
    references public.operation_occurrences (id, brand_id, location_id) on delete restrict;

alter table public.operation_step_responses alter column responded_by drop not null;
alter table public.operation_step_responses
  drop constraint operation_step_responses_responded_by_brand_id_fkey,
  add constraint operation_responses_responded_by_brand_fkey
    foreign key (responded_by, brand_id)
    references public.brand_users (id, brand_id) on delete set null (responded_by);

alter table public.training_competency_awards
  drop constraint training_competency_awards_competency_id_brand_id_fkey,
  add column award_source text not null default 'training'
    check (award_source in ('training', 'manager_verification')),
  add column verification_reason text not null default '',
  add column action_id uuid,
  add column revoked_at timestamptz,
  add column revoked_by uuid,
  add column revoked_action_id uuid,
  add column revocation_reason text not null default '',
  add constraint training_awards_competency_brand_fkey
    foreign key (competency_id, brand_id)
    references public.training_competencies (id, brand_id) on delete restrict,
  add constraint training_awards_revoker_brand_fkey
    foreign key (revoked_by, brand_id)
    references public.brand_users (id, brand_id) on delete set null (revoked_by),
  add constraint training_awards_source_reason_check check (
    award_source = 'training' or length(btrim(verification_reason)) between 3 and 500
  );

-- The legacy shift table used independent foreign keys, which allowed a
-- location or member from another tenant to be paired with the row brand.
alter table public.shifts
  drop constraint shifts_location_id_fkey,
  drop constraint shifts_brand_user_id_fkey,
  add constraint shifts_location_brand_fkey foreign key (location_id, brand_id)
    references public.locations (id, brand_id) on delete cascade,
  add constraint shifts_member_brand_fkey foreign key (brand_user_id, brand_id)
    references public.brand_users (id, brand_id) on delete cascade;

create table public.operation_action_receipts (
  id uuid primary key default gen_random_uuid(),
  action_id uuid not null,
  brand_id uuid not null references public.brands (id) on delete cascade,
  location_id uuid not null,
  occurrence_id uuid not null,
  actor_id uuid,
  action_type text not null check (action_type in (
    'claim', 'complete', 'release', 'cancel', 'report_issue', 'resolve_issue', 'update_issue', 'manual_create',
    'register_device', 'unregister_device', 'ack_notification', 'grant_competency', 'revoke_competency'
  )),
  result_id uuid not null,
  created_at timestamptz not null default now(),
  foreign key (location_id, brand_id) references public.locations (id, brand_id) on delete cascade,
  foreign key (occurrence_id, brand_id, location_id)
    references public.operation_occurrences (id, brand_id, location_id) on delete restrict,
  foreign key (actor_id, brand_id)
    references public.brand_users (id, brand_id) on delete set null (actor_id),
  unique nulls not distinct (brand_id, actor_id, action_id)
);
alter table public.operation_action_receipts enable row level security;
revoke all on public.operation_action_receipts from public, anon, authenticated;
grant all on public.operation_action_receipts to service_role;

create table public.operation_staff_devices (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  brand_user_id uuid not null,
  expo_push_token text not null check (length(expo_push_token) between 10 and 512),
  platform text not null check (platform in ('ios', 'android')),
  is_active boolean not null default true,
  last_action_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (brand_user_id, brand_id)
    references public.brand_users (id, brand_id) on delete cascade,
  unique (brand_id, expo_push_token),
  unique (brand_id, brand_user_id, last_action_id),
  unique (id, brand_id)
);

create table public.operation_operator_notifications (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  location_id uuid not null,
  occurrence_id uuid,
  recipient_id uuid not null,
  outbox_id uuid,
  notification_kind text not null default 'overdue'
    check (notification_kind in ('due', 'overdue', 'assignment', 'issue', 'system')),
  title text not null check (length(btrim(title)) between 1 and 200),
  body text not null default '' check (length(body) <= 1000),
  read_at timestamptz,
  acknowledged_action_id uuid,
  created_at timestamptz not null default now(),
  foreign key (location_id, brand_id)
    references public.locations (id, brand_id) on delete cascade,
  foreign key (occurrence_id, brand_id, location_id)
    references public.operation_occurrences (id, brand_id, location_id) on delete restrict,
  foreign key (recipient_id, brand_id)
    references public.brand_users (id, brand_id) on delete cascade,
  foreign key (outbox_id) references public.operation_notification_outbox (id) on delete restrict,
  unique (outbox_id),
  unique (brand_id, recipient_id, acknowledged_action_id),
  unique (id, brand_id)
);

alter table public.operation_staff_devices enable row level security;
alter table public.operation_operator_notifications enable row level security;
create policy operation_devices_read on public.operation_staff_devices for select to authenticated
  using (app.is_current_brand_user(brand_id, brand_user_id)
    and app.brand_operations_enabled(brand_id));
create policy operation_notifications_read on public.operation_operator_notifications
  for select to authenticated using (
    app.is_current_brand_user(brand_id, recipient_id)
    and app.brand_operations_enabled(brand_id)
  );
revoke all on public.operation_staff_devices, public.operation_operator_notifications
  from public, anon, authenticated;
grant select on public.operation_staff_devices, public.operation_operator_notifications
  to authenticated;
grant all on public.operation_staff_devices, public.operation_operator_notifications
  to service_role;

create trigger operation_staff_devices_touch before update on public.operation_staff_devices
  for each row execute function app.touch_updated_at();
create index operation_devices_member_idx
  on public.operation_staff_devices (brand_user_id) where is_active;
create index operation_notifications_feed_idx
  on public.operation_operator_notifications (recipient_id, read_at, created_at desc);

create index operation_templates_location_idx
  on public.operation_task_templates (location_id) where location_id is not null;
create index operation_templates_brand_source_idx
  on public.operation_task_templates (brand_template_id) where brand_template_id is not null;
create index operation_templates_creator_idx
  on public.operation_task_templates (created_by) where created_by is not null;
create index operation_schedules_template_idx on public.operation_schedules (template_id);
create index operation_schedules_creator_idx
  on public.operation_schedules (created_by) where created_by is not null;
create index operation_occurrences_schedule_idx
  on public.operation_occurrences (schedule_id) where schedule_id is not null;
create index operation_occurrences_template_idx on public.operation_occurrences (template_id);
create index operation_occurrences_claimant_idx
  on public.operation_occurrences (claimed_by) where claimed_by is not null;
create index operation_issues_occurrence_idx on public.operation_issues (occurrence_id, created_at);
create index operation_issues_reporter_idx
  on public.operation_issues (reported_by) where reported_by is not null;
create index operation_issues_resolver_idx
  on public.operation_issues (resolved_by) where resolved_by is not null;
create index operation_outbox_rule_idx on public.operation_notification_outbox (escalation_rule_id);
create index operation_outbox_recipient_idx on public.operation_notification_outbox (recipient_id);
create index operation_retention_updater_idx
  on public.operation_retention_policies (updated_by) where updated_by is not null;
create index operation_awards_release_idx
  on public.training_competency_awards (release_id) where release_id is not null;
create index operation_awards_awarder_idx
  on public.training_competency_awards (awarded_by) where awarded_by is not null;
create index operation_awards_revoker_idx
  on public.training_competency_awards (revoked_by) where revoked_by is not null;
create unique index operation_awards_action_key
  on public.training_competency_awards (brand_id, action_id) where action_id is not null;
create unique index operation_awards_current_key
  on public.training_competency_awards (competency_id, brand_user_id) where revoked_at is null;
create unique index operation_awards_revoke_action_key
  on public.training_competency_awards (brand_id, revoked_action_id)
  where revoked_action_id is not null;
create index operation_receipts_occurrence_idx
  on public.operation_action_receipts (occurrence_id, created_at);

create or replace function app.protect_operation_audit_record() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE'
    and old.actor_id is not null and new.actor_id is null
    and (to_jsonb(new) - 'actor_id') = (to_jsonb(old) - 'actor_id') then
    return new;
  end if;
  raise exception using errcode = '55000', message = 'operation_audit_record_immutable';
end $$;
revoke all on function app.protect_operation_audit_record() from public, anon, authenticated;
create trigger operation_events_append_only before update or delete
  on public.operation_occurrence_events for each row execute function app.protect_operation_audit_record();
create trigger operation_action_receipts_append_only before update or delete
  on public.operation_action_receipts for each row execute function app.protect_operation_audit_record();

create or replace function app.validate_operation_schedule_links() returns trigger
language plpgsql set search_path = '' as $$
declare template_location uuid; template_routine text;
begin
  if not exists (select 1 from pg_timezone_names where name = new.timezone) then
    raise exception using errcode = '22023', message = 'operation_timezone_invalid';
  end if;
  if (select count(*) from unnest(new.weekdays) weekday)
    <> (select count(distinct weekday) from unnest(new.weekdays) weekday) then
    raise exception using errcode = '22023', message = 'operation_weekdays_duplicate';
  end if;
  select template.location_id, template.routine_kind into template_location, template_routine
  from public.operation_task_templates template
  where template.id = new.template_id and template.brand_id = new.brand_id;
  if not found or (template_location is not null and template_location <> new.location_id) then
    raise exception using errcode = '23514', message = 'operation_template_location_mismatch';
  end if;
  if (template_routine = 'opening' and new.schedule_kind <> 'opening_offset')
    or (template_routine = 'closing' and new.schedule_kind <> 'closing_offset')
    or (template_routine = 'interval' and new.schedule_kind <> 'open_interval') then
    raise exception using errcode = '23514', message = 'operation_schedule_routine_mismatch';
  end if;
  return new;
end $$;
revoke all on function app.validate_operation_schedule_links() from public, anon, authenticated;
create trigger operation_schedule_links before insert or update
  on public.operation_schedules for each row execute function app.validate_operation_schedule_links();

create or replace function app.reject_used_operation_step_change() returns trigger
language plpgsql set search_path = '' as $$
declare target_template uuid;
begin
  target_template := case when tg_op = 'DELETE' then old.template_id else new.template_id end;
  if exists (select 1 from public.operation_occurrences where template_id = target_template) then
    raise exception using errcode = '55000', message = 'operation_template_revision_in_use';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
revoke all on function app.reject_used_operation_step_change() from public, anon, authenticated;
create trigger operation_steps_protect_history before insert or update or delete
  on public.operation_task_steps for each row execute function app.reject_used_operation_step_change();

create or replace function app.reject_used_operation_template_change() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE'
    and (to_jsonb(new) - array['is_active', 'updated_at'])
      = (to_jsonb(old) - array['is_active', 'updated_at']) then return new;
  end if;
  if exists (select 1 from public.operation_occurrences where template_id = old.id) then
    raise exception using errcode = '55000', message = 'operation_template_revision_in_use';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
revoke all on function app.reject_used_operation_template_change()
  from public, anon, authenticated;
create trigger operation_templates_protect_history before update or delete
  on public.operation_task_templates for each row execute function app.reject_used_operation_template_change();

create or replace function app.operation_snapshot_valid(snapshot jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(
    jsonb_typeof(snapshot) = 'object'
    and jsonb_typeof(snapshot->'steps') = 'array'
    and jsonb_typeof(snapshot->'requiredRoleIds') = 'array'
    and jsonb_typeof(snapshot->'requiredCompetencyKeys') = 'array'
    and snapshot->>'programKey' ~ '^[a-z0-9][a-z0-9-]{0,79}$'
    and snapshot->>'routineKind' in ('opening', 'interval', 'closing', 'ad_hoc')
    and length(btrim(snapshot->>'title')) between 1 and 200,
    false
  )
$$;
revoke all on function app.operation_snapshot_valid(jsonb) from public, anon;
grant execute on function app.operation_snapshot_valid(jsonb) to authenticated, service_role;
alter table public.operation_occurrences
  add constraint operation_occurrences_snapshot_shape_check
  check (app.operation_snapshot_valid(template_snapshot)) not valid;

create or replace function app.build_operation_snapshot(target_template uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'templateId', template.id,
    'templateKey', template.template_key,
    'programKey', template.program_key,
    'routineKind', template.routine_kind,
    'revision', template.revision,
    'title', template.title,
    'instructions', template.instructions,
    'estimatedMinutes', template.estimated_minutes,
    'requiredRoleIds', to_jsonb(template.required_role_ids),
    'requiredCompetencyKeys', to_jsonb(template.required_competency_keys),
    'issueCategories', coalesce(template.evidence_policy->'issueCategories', '[]'::jsonb),
    'steps', coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', step.step_key,
        'title', step.title,
        'instructions', step.instructions,
        'responseKind', step.response_kind,
        'required', step.is_required,
        'issueOnFailure', step.issue_on_failure,
        'allowNotApplicable', step.allow_not_applicable,
        'minimum', step.constraints->'minimum',
        'maximum', step.constraints->'maximum',
        'maxLength', step.constraints->'maxLength',
        'constraints', step.constraints
      ) order by step.sort_order, step.id)
      from public.operation_task_steps step
      where step.template_id = template.id
    ), '[]'::jsonb)
  )
  from public.operation_task_templates template where template.id = target_template
$$;
revoke all on function app.build_operation_snapshot(uuid) from public, anon, authenticated;
grant execute on function app.build_operation_snapshot(uuid) to service_role;

create or replace function app.operation_actor_is_eligible(
  selected public.operation_occurrences,
  target_actor uuid
) returns boolean language plpgsql stable security definer set search_path = '' as $$
declare required_competency text;
begin
  if not exists (
    select 1 from public.shifts shift
    where shift.brand_id = selected.brand_id
      and shift.location_id = selected.location_id
      and shift.brand_user_id = target_actor
      and shift.starts_at < selected.due_at
      and shift.ends_at > selected.scheduled_for
  ) then return false; end if;
  if jsonb_array_length(selected.template_snapshot->'requiredRoleIds') > 0 and not exists (
    select 1 from public.workforce_role_assignments assignment
    join public.workforce_roles role on role.id = assignment.workforce_role_id
      and role.brand_id = assignment.brand_id and role.is_active
    where assignment.brand_id = selected.brand_id and assignment.brand_user_id = target_actor
      and (assignment.location_id is null or assignment.location_id = selected.location_id)
      and assignment.workforce_role_id::text in (
        select jsonb_array_elements_text(selected.template_snapshot->'requiredRoleIds')
      )
  ) then return false; end if;
  for required_competency in select jsonb_array_elements_text(
    selected.template_snapshot->'requiredCompetencyKeys'
  ) loop
    if not exists (
      select 1 from public.training_competency_awards award
      join public.training_competencies competency on competency.id = award.competency_id
        and competency.brand_id = award.brand_id and competency.is_active
      where award.brand_id = selected.brand_id and award.brand_user_id = target_actor
        and competency.competency_key = required_competency
        and award.revoked_at is null
        and (award.expires_at is null or award.expires_at > now())
    ) then return false; end if;
  end loop;
  return true;
end $$;
revoke all on function app.operation_actor_is_eligible(public.operation_occurrences, uuid)
  from public, anon, authenticated;

create or replace function app.operation_response_valid(step jsonb, response jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare kind text := step->>'responseKind'; constraints jsonb := coalesce(step->'constraints', '{}'::jsonb);
  number_value numeric; text_value text;
begin
  if coalesce((step->>'allowNotApplicable')::boolean, false)
    and jsonb_typeof(response) = 'object'
    and response->>'state' = 'not_applicable' then
    return length(btrim(coalesce(response->>'reason', ''))) between 3 and 500;
  end if;
  if kind = 'confirm' then return response = 'true'::jsonb; end if;
  if kind = 'pass_fail' then return jsonb_typeof(response) = 'boolean'; end if;
  if kind = 'number' then
    if jsonb_typeof(response) <> 'number' then return false; end if;
    number_value := (response #>> '{}')::numeric;
    return (constraints->>'minimum' is null or number_value >= (constraints->>'minimum')::numeric)
      and (constraints->>'maximum' is null or number_value <= (constraints->>'maximum')::numeric);
  end if;
  if kind <> 'text' or jsonb_typeof(response) <> 'string' then return false; end if;
  text_value := response #>> '{}';
  return (not coalesce((step->>'required')::boolean, true) or length(btrim(text_value)) > 0)
    and (constraints->>'maxLength' is null or length(text_value) <= (constraints->>'maxLength')::integer);
exception when invalid_text_representation or numeric_value_out_of_range then return false;
end $$;
revoke all on function app.operation_response_valid(jsonb, jsonb) from public, anon;
grant execute on function app.operation_response_valid(jsonb, jsonb) to authenticated, service_role;

create or replace function app.operation_actor_for(selected public.operation_occurrences)
returns public.brand_users language sql stable security definer set search_path = '' as $$
  select member.* from public.brand_users member
  where member.brand_id = selected.brand_id and member.user_id = (select auth.uid())
    and (member.role = 'brand_owner' or selected.location_id = any(member.location_ids))
$$;
revoke all on function app.operation_actor_for(public.operation_occurrences)
  from public, anon, authenticated;

drop function public.claim_operation_occurrence(uuid);
drop function public.complete_operation_occurrence(uuid, jsonb, text);

create or replace function public.claim_operation_occurrence(
  target_occurrence uuid,
  target_action_id uuid
) returns public.operation_occurrences
language plpgsql security definer set search_path = '' as $$
declare selected public.operation_occurrences; actor public.brand_users; receipt public.operation_action_receipts;
begin
  select * into selected from public.operation_occurrences where id = target_occurrence for update;
  if not found or not app.brand_operations_enabled(selected.brand_id)
    or not app.operation_location_access(selected.brand_id, selected.location_id) then
    raise exception using errcode = '42501', message = 'operation_occurrence_not_accessible';
  end if;
  actor := app.operation_actor_for(selected);
  if actor.id is null then raise exception using errcode = '42501', message = 'operation_actor_not_found'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    actor.id::text || ':' || target_action_id::text, 0
  ));
  select * into receipt from public.operation_action_receipts
    where brand_id = selected.brand_id and actor_id = actor.id and action_id = target_action_id;
  if found then
    if receipt.action_type <> 'claim' or receipt.occurrence_id <> selected.id then
      raise exception using errcode = '22023', message = 'operation_action_id_conflict';
    end if;
    return selected;
  end if;
  if selected.status <> 'scheduled' or selected.scheduled_for > now() then
    raise exception using errcode = 'P0001', message = 'operation_occurrence_not_claimable';
  end if;
  if not app.operation_actor_is_eligible(selected, actor.id) then
    raise exception using errcode = '42501', message = 'operation_eligibility_required';
  end if;
  update public.operation_occurrences set status = 'claimed', claimed_by = actor.id,
    claimed_at = now(), claim_expires_at = now() + interval '2 hours'
    where id = selected.id returning * into selected;
  insert into public.operation_occurrence_events (brand_id, occurrence_id, event_type, actor_id)
    values (selected.brand_id, selected.id, 'claimed', actor.id);
  insert into public.operation_action_receipts
    (action_id, brand_id, location_id, occurrence_id, actor_id, action_type, result_id)
    values (target_action_id, selected.brand_id, selected.location_id, selected.id, actor.id, 'claim', selected.id);
  return selected;
end $$;
revoke all on function public.claim_operation_occurrence(uuid, uuid) from public, anon;
grant execute on function public.claim_operation_occurrence(uuid, uuid) to authenticated;

create or replace function app.validate_operation_completion(
  selected public.operation_occurrences,
  responses jsonb
) returns void language plpgsql stable security definer set search_path = '' as $$
declare step jsonb; response_key text;
begin
  if jsonb_typeof(responses) <> 'object' then
    raise exception using errcode = '22023', message = 'operation_responses_invalid';
  end if;
  for response_key in select jsonb_object_keys(responses) loop
    if not exists (select 1 from jsonb_array_elements(selected.template_snapshot->'steps') candidate
      where candidate->>'key' = response_key) then
      raise exception using errcode = '22023', message = 'operation_response_unknown';
    end if;
  end loop;
  for step in select value from jsonb_array_elements(selected.template_snapshot->'steps') loop
    if coalesce((step->>'required')::boolean, true) and not responses ? (step->>'key') then
      raise exception using errcode = '22023', message = 'operation_required_response_missing';
    end if;
    if responses ? (step->>'key') and not app.operation_response_valid(step, responses->(step->>'key')) then
      raise exception using errcode = '22023', message = 'operation_response_invalid';
    end if;
    if coalesce((step->>'issueOnFailure')::boolean, false)
      and responses->(step->>'key') = 'false'::jsonb and not exists (
        select 1 from public.operation_issues issue where issue.occurrence_id = selected.id
          and issue.step_key = step->>'key' and issue.status in ('open', 'acknowledged', 'resolved')
      ) then raise exception using errcode = '22023', message = 'operation_issue_required'; end if;
  end loop;
end $$;
revoke all on function app.validate_operation_completion(public.operation_occurrences, jsonb)
  from public, anon, authenticated;

create or replace function app.insert_operation_completion_issues(
  selected public.operation_occurrences,
  actor public.brand_users,
  issues jsonb
) returns void language plpgsql security definer set search_path = '' as $$
declare issue jsonb; created_issue public.operation_issues; categories jsonb;
begin
  if jsonb_typeof(issues) <> 'array' then
    raise exception using errcode = '22023', message = 'operation_issues_invalid';
  end if;
  categories := selected.template_snapshot->'issueCategories';
  for issue in select value from jsonb_array_elements(issues) loop
    if jsonb_typeof(issue) <> 'object'
      or length(btrim(issue->>'category')) not between 1 and 100
      or (jsonb_array_length(categories) > 0 and not categories ? (issue->>'category'))
      or issue->>'severity' not in ('low', 'normal', 'high', 'urgent')
      or length(btrim(coalesce(issue->>'description', ''))) not between 1 and 2000
      or (issue->>'stepKey' is not null and not exists (
        select 1 from jsonb_array_elements(selected.template_snapshot->'steps') step
        where step->>'key' = issue->>'stepKey'
      )) then raise exception using errcode = '22023', message = 'operation_issue_invalid'; end if;
    insert into public.operation_issues
      (brand_id, location_id, occurrence_id, step_key, category, severity, description, reported_by)
      values (selected.brand_id, selected.location_id, selected.id, issue->>'stepKey',
        btrim(issue->>'category'), issue->>'severity', btrim(issue->>'description'), actor.id)
      returning * into created_issue;
    insert into public.operation_occurrence_events
      (brand_id, occurrence_id, event_type, actor_id, detail)
      values (selected.brand_id, selected.id, 'issue_reported', actor.id,
        jsonb_build_object('issueId', created_issue.id, 'category', created_issue.category,
          'severity', created_issue.severity, 'stepKey', created_issue.step_key));
  end loop;
end $$;
revoke all on function app.insert_operation_completion_issues(
  public.operation_occurrences, public.brand_users, jsonb
) from public, anon, authenticated;

create or replace function public.complete_operation_occurrence(
  target_occurrence uuid,
  target_action_id uuid,
  target_responses jsonb,
  target_note text default '',
  target_issues jsonb default '[]'::jsonb
) returns public.operation_occurrences
language plpgsql security definer set search_path = '' as $$
declare selected public.operation_occurrences; actor public.brand_users; receipt public.operation_action_receipts;
begin
  select * into selected from public.operation_occurrences where id = target_occurrence for update;
  if not found or not app.brand_operations_enabled(selected.brand_id)
    or not app.operation_location_access(selected.brand_id, selected.location_id) then
    raise exception using errcode = '42501', message = 'operation_occurrence_not_accessible';
  end if;
  actor := app.operation_actor_for(selected);
  if actor.id is null then raise exception using errcode = '42501', message = 'operation_actor_not_found'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    actor.id::text || ':' || target_action_id::text, 0
  ));
  select * into receipt from public.operation_action_receipts
    where brand_id = selected.brand_id and actor_id = actor.id and action_id = target_action_id;
  if found then
    if receipt.action_type <> 'complete' or receipt.occurrence_id <> selected.id then
      raise exception using errcode = '22023', message = 'operation_action_id_conflict';
    end if;
    return selected;
  end if;
  if selected.claimed_by is distinct from actor.id or selected.status <> 'claimed' then
    raise exception using errcode = '42501', message = 'operation_occurrence_not_owned';
  end if;
  if not app.operation_actor_is_eligible(selected, actor.id) then
    raise exception using errcode = '42501', message = 'operation_eligibility_required';
  end if;
  if length(coalesce(target_note, '')) > 2000 then
    raise exception using errcode = '22023', message = 'operation_note_too_long';
  end if;
  perform app.insert_operation_completion_issues(selected, actor, target_issues);
  perform app.validate_operation_completion(selected, target_responses);
  insert into public.operation_step_responses
    (brand_id, occurrence_id, step_key, response, responded_by)
    select selected.brand_id, selected.id, response.key, response.value, actor.id
    from jsonb_each(target_responses) response;
  update public.operation_occurrences set status = 'completed', completed_at = now(),
    claim_expires_at = null, completion_note = coalesce(target_note, '')
    where id = selected.id returning * into selected;
  insert into public.operation_occurrence_events (brand_id, occurrence_id, event_type, actor_id)
    values (selected.brand_id, selected.id, 'completed', actor.id);
  insert into public.operation_action_receipts
    (action_id, brand_id, location_id, occurrence_id, actor_id, action_type, result_id)
    values (target_action_id, selected.brand_id, selected.location_id, selected.id, actor.id, 'complete', selected.id);
  return selected;
end $$;
revoke all on function public.complete_operation_occurrence(uuid, uuid, jsonb, text, jsonb)
  from public, anon;
grant execute on function public.complete_operation_occurrence(uuid, uuid, jsonb, text, jsonb)
  to authenticated;

create or replace function public.report_operation_issue(
  target_occurrence uuid,
  target_action_id uuid,
  target_category text,
  target_severity text,
  target_description text,
  target_step_key text default null
) returns public.operation_issues
language plpgsql security definer set search_path = '' as $$
declare selected public.operation_occurrences; actor public.brand_users; receipt public.operation_action_receipts;
  created_issue public.operation_issues; categories jsonb;
begin
  select * into selected from public.operation_occurrences where id = target_occurrence for update;
  if not found or not app.brand_operations_enabled(selected.brand_id)
    or not app.operation_location_access(selected.brand_id, selected.location_id) then
    raise exception using errcode = '42501', message = 'operation_occurrence_not_accessible';
  end if;
  actor := app.operation_actor_for(selected);
  if actor.id is null then raise exception using errcode = '42501', message = 'operation_actor_not_found'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    actor.id::text || ':' || target_action_id::text, 0
  ));
  select * into receipt from public.operation_action_receipts
    where brand_id = selected.brand_id and actor_id = actor.id and action_id = target_action_id;
  if found then
    if receipt.action_type <> 'report_issue' or receipt.occurrence_id <> selected.id then
      raise exception using errcode = '22023', message = 'operation_action_id_conflict';
    end if;
    select * into created_issue from public.operation_issues where id = receipt.result_id;
    return created_issue;
  end if;
  categories := selected.template_snapshot->'issueCategories';
  if length(btrim(target_category)) not between 1 and 100
    or (jsonb_array_length(categories) > 0 and not categories ? target_category)
    or target_severity not in ('low', 'normal', 'high', 'urgent')
    or length(btrim(coalesce(target_description, ''))) not between 1 and 2000 then
    raise exception using errcode = '22023', message = 'operation_issue_invalid';
  end if;
  if target_step_key is not null and not exists (
    select 1 from jsonb_array_elements(selected.template_snapshot->'steps') step
    where step->>'key' = target_step_key
  ) then raise exception using errcode = '22023', message = 'operation_issue_step_invalid'; end if;
  insert into public.operation_issues
    (brand_id, location_id, occurrence_id, step_key, category, severity, description, reported_by)
    values (selected.brand_id, selected.location_id, selected.id, target_step_key, btrim(target_category),
      target_severity, coalesce(target_description, ''), actor.id) returning * into created_issue;
  insert into public.operation_occurrence_events
    (brand_id, occurrence_id, event_type, actor_id, detail)
    values (selected.brand_id, selected.id, 'issue_reported', actor.id,
      jsonb_build_object('issueId', created_issue.id, 'category', created_issue.category,
        'severity', created_issue.severity, 'stepKey', created_issue.step_key));
  insert into public.operation_action_receipts
    (action_id, brand_id, location_id, occurrence_id, actor_id, action_type, result_id)
    values (target_action_id, selected.brand_id, selected.location_id, selected.id,
      actor.id, 'report_issue', created_issue.id);
  return created_issue;
end $$;
revoke all on function public.report_operation_issue(uuid, uuid, text, text, text, text)
  from public, anon;
grant execute on function public.report_operation_issue(uuid, uuid, text, text, text, text)
  to authenticated;

create or replace function public.resolve_operation_issue(
  target_issue uuid,
  target_action_id uuid,
  target_resolution text
) returns public.operation_issues
language plpgsql security definer set search_path = '' as $$
declare selected public.operation_issues; occurrence public.operation_occurrences;
  actor public.brand_users; receipt public.operation_action_receipts;
begin
  select * into selected from public.operation_issues where id = target_issue for update;
  if not found or not app.operation_location_manager(selected.brand_id, selected.location_id) then
    raise exception using errcode = '42501', message = 'operation_manager_required';
  end if;
  select * into occurrence from public.operation_occurrences where id = selected.occurrence_id;
  actor := app.operation_actor_for(occurrence);
  if actor.id is null then raise exception using errcode = '42501', message = 'operation_actor_not_found'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    actor.id::text || ':' || target_action_id::text, 0
  ));
  select * into receipt from public.operation_action_receipts
    where brand_id = selected.brand_id and actor_id = actor.id and action_id = target_action_id;
  if found then
    if receipt.action_type <> 'resolve_issue' or receipt.result_id <> selected.id then
      raise exception using errcode = '22023', message = 'operation_action_id_conflict';
    end if;
    return selected;
  end if;
  if selected.status not in ('open', 'acknowledged')
    or length(btrim(target_resolution)) not between 3 and 2000 then
    raise exception using errcode = '22023', message = 'operation_issue_resolution_invalid';
  end if;
  update public.operation_issues set status = 'resolved', resolved_by = actor.id,
    resolved_at = now(), resolution = btrim(target_resolution)
    where id = selected.id returning * into selected;
  insert into public.operation_occurrence_events
    (brand_id, occurrence_id, event_type, actor_id, detail)
    values (selected.brand_id, selected.occurrence_id, 'issue_resolved', actor.id,
      jsonb_build_object('issueId', selected.id));
  insert into public.operation_action_receipts
    (action_id, brand_id, location_id, occurrence_id, actor_id, action_type, result_id)
    values (target_action_id, selected.brand_id, selected.location_id, selected.occurrence_id,
      actor.id, 'resolve_issue', selected.id);
  return selected;
end $$;
revoke all on function public.resolve_operation_issue(uuid, uuid, text) from public, anon;
grant execute on function public.resolve_operation_issue(uuid, uuid, text) to authenticated;

create or replace function public.cancel_operation_occurrence(
  target_occurrence uuid,
  target_action_id uuid,
  target_reason text
) returns public.operation_occurrences
language plpgsql security definer set search_path = '' as $$
declare selected public.operation_occurrences; actor public.brand_users; receipt public.operation_action_receipts;
begin
  select * into selected from public.operation_occurrences where id = target_occurrence for update;
  if not found or not app.operation_location_manager(selected.brand_id, selected.location_id)
    or not app.brand_operations_enabled(selected.brand_id) then
    raise exception using errcode = '42501', message = 'operation_manager_required';
  end if;
  actor := app.operation_actor_for(selected);
  if actor.id is null then raise exception using errcode = '42501', message = 'operation_actor_not_found'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    actor.id::text || ':' || target_action_id::text, 0
  ));
  select * into receipt from public.operation_action_receipts
    where brand_id = selected.brand_id and actor_id = actor.id and action_id = target_action_id;
  if found then
    if receipt.action_type <> 'cancel' or receipt.occurrence_id <> selected.id then
      raise exception using errcode = '22023', message = 'operation_action_id_conflict';
    end if;
    return selected;
  end if;
  if selected.status in ('completed', 'missed', 'cancelled') or length(btrim(target_reason)) not between 3 and 500 then
    raise exception using errcode = '22023', message = 'operation_cancellation_invalid';
  end if;
  update public.operation_occurrences set status = 'cancelled', claim_expires_at = null
    where id = selected.id returning * into selected;
  insert into public.operation_occurrence_events (brand_id, occurrence_id, event_type, actor_id, reason)
    values (selected.brand_id, selected.id, 'cancelled', actor.id, btrim(target_reason));
  insert into public.operation_action_receipts
    (action_id, brand_id, location_id, occurrence_id, actor_id, action_type, result_id)
    values (target_action_id, selected.brand_id, selected.location_id, selected.id, actor.id, 'cancel', selected.id);
  return selected;
end $$;
revoke all on function public.cancel_operation_occurrence(uuid, uuid, text) from public, anon;
grant execute on function public.cancel_operation_occurrence(uuid, uuid, text) to authenticated;

create or replace function public.release_operation_occurrence(
  target_occurrence uuid,
  target_action_id uuid
) returns public.operation_occurrences
language plpgsql security definer set search_path = '' as $$
declare selected public.operation_occurrences; actor public.brand_users;
  receipt public.operation_action_receipts;
begin
  select * into selected from public.operation_occurrences where id = target_occurrence for update;
  if not found or not app.operation_location_access(selected.brand_id, selected.location_id) then
    raise exception using errcode = '42501', message = 'operation_occurrence_not_accessible';
  end if;
  actor := app.operation_actor_for(selected);
  if actor.id is null then raise exception using errcode = '42501', message = 'operation_actor_not_found'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    actor.id::text || ':' || target_action_id::text, 0
  ));
  select * into receipt from public.operation_action_receipts
    where brand_id = selected.brand_id and actor_id = actor.id and action_id = target_action_id;
  if found then
    if receipt.action_type <> 'release' or receipt.occurrence_id <> selected.id then
      raise exception using errcode = '22023', message = 'operation_action_id_conflict';
    end if;
    return selected;
  end if;
  if selected.claimed_by is null or selected.status <> 'claimed'
    or (selected.claimed_by <> actor.id
      and not app.operation_location_manager(selected.brand_id, selected.location_id)) then
    raise exception using errcode = '42501', message = 'operation_occurrence_not_owned';
  end if;
  update public.operation_occurrences set status = 'scheduled',
    claimed_by = null, claimed_at = null, claim_expires_at = null
    where id = selected.id returning * into selected;
  insert into public.operation_occurrence_events (brand_id, occurrence_id, event_type, actor_id, reason)
    values (selected.brand_id, selected.id, 'released', actor.id, 'operator_release');
  insert into public.operation_action_receipts
    (action_id, brand_id, location_id, occurrence_id, actor_id, action_type, result_id)
    values (target_action_id, selected.brand_id, selected.location_id, selected.id,
      actor.id, 'release', selected.id);
  return selected;
end $$;
revoke all on function public.release_operation_occurrence(uuid, uuid) from public, anon;
grant execute on function public.release_operation_occurrence(uuid, uuid) to authenticated;

create or replace function public.update_operation_issue(
  target_issue uuid,
  target_action_id uuid,
  target_status text,
  target_resolution text default ''
) returns public.operation_issues
language plpgsql security definer set search_path = '' as $$
declare selected public.operation_issues; occurrence public.operation_occurrences;
  actor public.brand_users; receipt public.operation_action_receipts; event_name text;
begin
  select * into selected from public.operation_issues where id = target_issue for update;
  if not found or not app.operation_location_manager(selected.brand_id, selected.location_id) then
    raise exception using errcode = '42501', message = 'operation_manager_required';
  end if;
  select * into occurrence from public.operation_occurrences where id = selected.occurrence_id;
  actor := app.operation_actor_for(occurrence);
  if actor.id is null then raise exception using errcode = '42501', message = 'operation_actor_not_found'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    actor.id::text || ':' || target_action_id::text, 0
  ));
  select * into receipt from public.operation_action_receipts
    where brand_id = selected.brand_id and actor_id = actor.id and action_id = target_action_id;
  if found then
    if receipt.action_type <> 'update_issue' or receipt.result_id <> selected.id then
      raise exception using errcode = '22023', message = 'operation_action_id_conflict';
    end if;
    return selected;
  end if;
  if target_status not in ('acknowledged', 'resolved', 'dismissed')
    or selected.status not in ('open', 'acknowledged')
    or (selected.status = 'acknowledged' and target_status = 'acknowledged')
    or length(coalesce(target_resolution, '')) > 2000
    or (target_status = 'resolved' and length(btrim(coalesce(target_resolution, ''))) < 3) then
    raise exception using errcode = '22023', message = 'operation_issue_transition_invalid';
  end if;
  event_name := case target_status when 'acknowledged' then 'issue_acknowledged'
    when 'resolved' then 'issue_resolved' else 'issue_dismissed' end;
  update public.operation_issues set status = target_status,
    resolved_by = case when target_status in ('resolved', 'dismissed') then actor.id else null end,
    resolved_at = case when target_status in ('resolved', 'dismissed') then now() else null end,
    resolution = btrim(coalesce(target_resolution, ''))
    where id = selected.id returning * into selected;
  insert into public.operation_occurrence_events
    (brand_id, occurrence_id, event_type, actor_id, detail)
    values (selected.brand_id, selected.occurrence_id, event_name, actor.id,
      jsonb_build_object('issueId', selected.id, 'status', selected.status));
  insert into public.operation_action_receipts
    (action_id, brand_id, location_id, occurrence_id, actor_id, action_type, result_id)
    values (target_action_id, selected.brand_id, selected.location_id, selected.occurrence_id,
      actor.id, 'update_issue', selected.id);
  return selected;
end $$;
revoke all on function public.update_operation_issue(uuid, uuid, text, text) from public, anon;
grant execute on function public.update_operation_issue(uuid, uuid, text, text) to authenticated;

create or replace function public.create_manual_operation_occurrence(
  target_location uuid,
  target_template uuid,
  target_action_id uuid,
  target_scheduled_for timestamptz default now(),
  target_due_window_minutes integer default 30
) returns public.operation_occurrences
language plpgsql security definer set search_path = '' as $$
declare template public.operation_task_templates; actor public.brand_users;
  receipt public.operation_action_receipts; created public.operation_occurrences;
begin
  select * into template from public.operation_task_templates where id = target_template and is_active;
  if not found or not app.operation_location_manager(template.brand_id, target_location)
    or (template.location_id is not null and template.location_id <> target_location) then
    raise exception using errcode = '42501', message = 'operation_manager_required';
  end if;
  if target_due_window_minutes not between 1 and 1440
    or target_scheduled_for < now() - interval '1 day'
    or target_scheduled_for > now() + interval '366 days' then
    raise exception using errcode = '22023', message = 'operation_manual_window_invalid';
  end if;
  select * into actor from public.brand_users member
    where member.brand_id = template.brand_id and member.user_id = (select auth.uid());
  if actor.id is null then raise exception using errcode = '42501', message = 'operation_actor_not_found'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    actor.id::text || ':' || target_action_id::text, 0
  ));
  select * into receipt from public.operation_action_receipts
    where brand_id = template.brand_id and actor_id = actor.id and action_id = target_action_id;
  if found then
    if receipt.action_type <> 'manual_create' then
      raise exception using errcode = '22023', message = 'operation_action_id_conflict';
    end if;
    select * into created from public.operation_occurrences where id = receipt.result_id;
    return created;
  end if;
  insert into public.operation_occurrences
    (brand_id, location_id, template_id, source, materialization_key, template_snapshot,
      scheduled_for, due_at, status)
    values (template.brand_id, target_location, template.id, 'manual',
      'manual:' || target_action_id::text, app.build_operation_snapshot(template.id),
      target_scheduled_for, target_scheduled_for + make_interval(mins => target_due_window_minutes),
      'scheduled')
    returning * into created;
  insert into public.operation_occurrence_events (brand_id, occurrence_id, event_type, actor_id)
    values (created.brand_id, created.id, 'created', actor.id);
  insert into public.operation_action_receipts
    (action_id, brand_id, location_id, occurrence_id, actor_id, action_type, result_id)
    values (target_action_id, created.brand_id, created.location_id, created.id,
      actor.id, 'manual_create', created.id);
  return created;
end $$;
revoke all on function public.create_manual_operation_occurrence(uuid, uuid, uuid, timestamptz, integer)
  from public, anon;
grant execute on function public.create_manual_operation_occurrence(uuid, uuid, uuid, timestamptz, integer)
  to authenticated;

create or replace function public.register_operation_device(
  target_action_id uuid,
  target_expo_push_token text,
  target_platform text
) returns public.operation_staff_devices
language plpgsql security definer set search_path = '' as $$
declare actor public.brand_users; selected public.operation_staff_devices;
begin
  select * into actor from public.brand_users member
    where member.brand_id = app.jwt_brand_id() and member.user_id = (select auth.uid());
  if actor.id is null or not app.operation_brand_staff(actor.brand_id) then
    raise exception using errcode = '42501', message = 'operation_actor_not_found';
  end if;
  if length(btrim(target_expo_push_token)) not between 10 and 512
    or target_platform not in ('ios', 'android') then
    raise exception using errcode = '22023', message = 'operation_device_invalid';
  end if;
  select * into selected from public.operation_staff_devices
    where brand_id = actor.brand_id and brand_user_id = actor.id
      and last_action_id = target_action_id;
  if found then
    if selected.expo_push_token <> btrim(target_expo_push_token)
      or selected.platform <> target_platform then
      raise exception using errcode = '22023', message = 'operation_action_id_conflict';
    end if;
    return selected;
  end if;
  insert into public.operation_staff_devices
    (brand_id, brand_user_id, expo_push_token, platform, last_action_id)
    values (actor.brand_id, actor.id, btrim(target_expo_push_token), target_platform, target_action_id)
    on conflict (brand_id, expo_push_token) do update set
      brand_user_id = excluded.brand_user_id, platform = excluded.platform,
      is_active = true, last_action_id = excluded.last_action_id
    returning * into selected;
  return selected;
end $$;
revoke all on function public.register_operation_device(uuid, text, text) from public, anon;
grant execute on function public.register_operation_device(uuid, text, text) to authenticated;

create or replace function public.unregister_operation_device(
  target_action_id uuid,
  target_device_id uuid
) returns public.operation_staff_devices
language plpgsql security definer set search_path = '' as $$
declare selected public.operation_staff_devices;
begin
  select * into selected from public.operation_staff_devices where id = target_device_id for update;
  if not found or not app.is_current_brand_user(selected.brand_id, selected.brand_user_id)
    or not app.brand_operations_enabled(selected.brand_id) then
    raise exception using errcode = '42501', message = 'operation_device_not_accessible';
  end if;
  if selected.last_action_id = target_action_id and not selected.is_active then return selected; end if;
  update public.operation_staff_devices set is_active = false, last_action_id = target_action_id
    where id = selected.id returning * into selected;
  return selected;
exception when unique_violation then
  raise exception using errcode = '22023', message = 'operation_action_id_conflict';
end $$;
revoke all on function public.unregister_operation_device(uuid, uuid) from public, anon;
grant execute on function public.unregister_operation_device(uuid, uuid) to authenticated;

create or replace function public.acknowledge_operation_notification(
  target_notification uuid,
  target_action_id uuid
) returns public.operation_operator_notifications
language plpgsql security definer set search_path = '' as $$
declare selected public.operation_operator_notifications;
begin
  select * into selected from public.operation_operator_notifications
    where id = target_notification for update;
  if not found or not app.is_current_brand_user(selected.brand_id, selected.recipient_id)
    or not app.brand_operations_enabled(selected.brand_id) then
    raise exception using errcode = '42501', message = 'operation_notification_not_accessible';
  end if;
  if selected.acknowledged_action_id = target_action_id then return selected; end if;
  if selected.acknowledged_action_id is not null then return selected; end if;
  update public.operation_operator_notifications set read_at = now(),
    acknowledged_action_id = target_action_id where id = selected.id returning * into selected;
  return selected;
exception when unique_violation then
  raise exception using errcode = '22023', message = 'operation_action_id_conflict';
end $$;
revoke all on function public.acknowledge_operation_notification(uuid, uuid) from public, anon;
grant execute on function public.acknowledge_operation_notification(uuid, uuid) to authenticated;

drop policy operation_templates_read on public.operation_task_templates;
create policy operation_templates_read on public.operation_task_templates for select to authenticated
  using (app.brand_operations_enabled(brand_id) and (
    (location_id is null and app.operation_brand_staff(brand_id))
    or (location_id is not null and app.operation_location_access(brand_id, location_id))
  ));
drop policy operation_steps_read on public.operation_task_steps;
create policy operation_steps_read on public.operation_task_steps for select to authenticated
  using (app.brand_operations_enabled(brand_id) and exists (
    select 1 from public.operation_task_templates template where template.id = template_id
      and ((template.location_id is null and app.operation_brand_staff(template.brand_id))
        or (template.location_id is not null
          and app.operation_location_access(template.brand_id, template.location_id)))
  ));
drop policy operation_schedules_read on public.operation_schedules;
create policy operation_schedules_read on public.operation_schedules for select to authenticated
  using (app.operation_location_access(brand_id, location_id));
drop policy operation_occurrences_read on public.operation_occurrences;
create policy operation_occurrences_read on public.operation_occurrences for select to authenticated
  using (app.operation_location_access(brand_id, location_id));
drop policy operation_issues_read on public.operation_issues;
create policy operation_issues_read on public.operation_issues for select to authenticated
  using (app.operation_location_access(brand_id, location_id));
drop policy operation_events_read on public.operation_occurrence_events;
create policy operation_events_read on public.operation_occurrence_events for select to authenticated
  using (app.brand_operations_enabled(brand_id) and exists (
    select 1 from public.operation_occurrences occurrence where occurrence.id = occurrence_id
      and app.operation_location_access(occurrence.brand_id, occurrence.location_id)
  ));
drop policy operation_responses_read on public.operation_step_responses;
create policy operation_responses_read on public.operation_step_responses for select to authenticated
  using (app.brand_operations_enabled(brand_id) and exists (
    select 1 from public.operation_occurrences occurrence where occurrence.id = occurrence_id
      and app.operation_location_access(occurrence.brand_id, occurrence.location_id)
  ));
drop policy operation_escalations_read on public.operation_escalation_rules;
create policy operation_escalations_read on public.operation_escalation_rules for select to authenticated
  using (app.brand_operations_enabled(brand_id) and (
    (schedule_id is null and app.operation_brand_owner(brand_id)) or exists (
      select 1 from public.operation_schedules schedule where schedule.id = schedule_id
        and app.operation_location_manager(schedule.brand_id, schedule.location_id)
    )
  ));
drop policy operation_escalations_manage on public.operation_escalation_rules;
create policy operation_escalations_manage on public.operation_escalation_rules for all to authenticated
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

drop policy operation_templates_manage on public.operation_task_templates;
create policy operation_templates_manage on public.operation_task_templates for all to authenticated
  using (app.brand_operations_enabled(brand_id) and (
    app.operation_brand_owner(brand_id)
    or (location_id is not null and app.operation_location_manager(brand_id, location_id))
  ))
  with check (app.brand_operations_enabled(brand_id) and (
    app.operation_brand_owner(brand_id)
    or (location_id is not null and app.operation_location_manager(brand_id, location_id))
  ));
drop policy operation_steps_manage on public.operation_task_steps;
create policy operation_steps_manage on public.operation_task_steps for all to authenticated
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
drop policy operation_schedules_manage on public.operation_schedules;
create policy operation_schedules_manage on public.operation_schedules for all to authenticated
  using (app.operation_location_manager(brand_id, location_id))
  with check (app.operation_location_manager(brand_id, location_id));
drop policy operation_retention_read on public.operation_retention_policies;
create policy operation_retention_read on public.operation_retention_policies for select to authenticated
  using (app.operation_brand_owner(brand_id));
drop policy operation_retention_manage on public.operation_retention_policies;
create policy operation_retention_manage on public.operation_retention_policies for all to authenticated
  using (app.operation_brand_owner(brand_id)) with check (app.operation_brand_owner(brand_id));
drop policy training_competencies_read on public.training_competencies;
create policy training_competencies_read on public.training_competencies for select to authenticated
  using (app.operation_brand_staff(brand_id));
drop policy training_competencies_manage on public.training_competencies;
create policy training_competencies_manage on public.training_competencies for all to authenticated
  using (app.operation_brand_owner(brand_id)) with check (app.operation_brand_owner(brand_id));
drop policy training_competency_awards_read on public.training_competency_awards;
create policy training_competency_awards_read on public.training_competency_awards for select to authenticated
  using (app.brand_operations_enabled(brand_id) and (
    app.is_current_brand_user(brand_id, brand_user_id)
    or app.operation_manager_can_view_member(brand_id, brand_user_id)
  ));
drop policy operations_change_signals_read on public.operations_change_signals;
create policy operations_change_signals_read on public.operations_change_signals for select to authenticated
  using (app.operation_location_access(brand_id, location_id));

create trigger operation_issues_signal after insert or update or delete
  on public.operation_issues for each row execute function app.signal_operations_change();
create trigger operation_schedules_signal after insert or update or delete
  on public.operation_schedules for each row execute function app.signal_operations_change();

create or replace function app.protect_operation_outbox() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '55000', message = 'operation_delivery_history_immutable';
  end if;
  if (to_jsonb(new) - array['status', 'attempt_count', 'available_at', 'sent_at', 'last_error'])
    <> (to_jsonb(old) - array['status', 'attempt_count', 'available_at', 'sent_at', 'last_error']) then
    raise exception using errcode = '55000', message = 'operation_delivery_identity_immutable';
  end if;
  if not ((old.status = 'pending' and new.status in ('sending', 'cancelled'))
    or (old.status = 'sending' and new.status in ('sent', 'failed', 'pending'))
    or (old.status = 'failed' and new.status in ('sending', 'cancelled'))
    or old.status = new.status) then
    raise exception using errcode = '22023', message = 'operation_delivery_transition_invalid';
  end if;
  return new;
end $$;
revoke all on function app.protect_operation_outbox() from public, anon, authenticated;
create trigger operation_outbox_protect before update or delete
  on public.operation_notification_outbox for each row execute function app.protect_operation_outbox();

create or replace function app.operation_schedule_starts(
  target_schedule public.operation_schedules,
  target_hours jsonb,
  target_service_day date
) returns setof timestamptz language plpgsql stable set search_path = '' as $$
declare weekday_key text; day_hours jsonb; first_open time; last_close timestamp;
  segment jsonb; opened time; closed time; local_open timestamp; local_close timestamp;
begin
  if not extract(isodow from target_service_day)::smallint = any(target_schedule.weekdays) then
    return;
  end if;
  if target_schedule.schedule_kind = 'fixed_time' then
    return next (target_service_day + target_schedule.local_start_time) at time zone target_schedule.timezone;
    return;
  end if;
  weekday_key := (array['mon','tue','wed','thu','fri','sat','sun'])[extract(isodow from target_service_day)::integer];
  day_hours := coalesce(target_hours->weekday_key, '[]'::jsonb);
  if jsonb_typeof(day_hours) <> 'array' or jsonb_array_length(day_hours) = 0 then return; end if;
  if target_schedule.schedule_kind = 'opening_offset' then
    select min((entry->>'open')::time) into first_open from jsonb_array_elements(day_hours) entry
      where entry->>'open' ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$';
    if first_open is not null then return next ((target_service_day + first_open
      + make_interval(mins => target_schedule.anchor_offset_minutes)) at time zone target_schedule.timezone); end if;
    return;
  end if;
  if target_schedule.schedule_kind = 'closing_offset' then
    for segment in select value from jsonb_array_elements(day_hours) loop
      if coalesce(segment->>'open', '') !~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'
        or coalesce(segment->>'close', '') !~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$' then continue; end if;
      opened := (segment->>'open')::time; closed := (segment->>'close')::time;
      local_close := target_service_day + closed + case when closed <= opened then interval '1 day' else interval '0' end;
      if last_close is null or local_close > last_close then last_close := local_close; end if;
    end loop;
    if last_close is not null then return next ((last_close
      + make_interval(mins => target_schedule.anchor_offset_minutes)) at time zone target_schedule.timezone); end if;
    return;
  end if;
  for segment in select value from jsonb_array_elements(day_hours) loop
    if coalesce(segment->>'open', '') !~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'
      or coalesce(segment->>'close', '') !~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$' then continue; end if;
    opened := (segment->>'open')::time; closed := (segment->>'close')::time;
    local_open := target_service_day + opened + make_interval(mins => target_schedule.anchor_offset_minutes);
    local_close := target_service_day + closed
      + case when closed <= opened then interval '1 day' else interval '0' end
      + make_interval(mins => target_schedule.interval_end_offset_minutes);
    if local_close >= local_open then return query select generated at time zone target_schedule.timezone
      from generate_series(local_open, local_close,
        make_interval(mins => target_schedule.interval_minutes)) generated; end if;
  end loop;
end $$;
revoke all on function app.operation_schedule_starts(public.operation_schedules, jsonb, date)
  from public, anon, authenticated;
grant execute on function app.operation_schedule_starts(public.operation_schedules, jsonb, date)
  to service_role;

create or replace function public.run_operation_maintenance(
  target_now timestamptz default now(),
  target_horizon_hours integer default 840
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare generated_count integer := 0; released_count integer := 0;
  missed_count integer := 0; outbox_count integer := 0;
begin
  if target_horizon_hours not between 1 and 840 then
    raise exception using errcode = '22023', message = 'operation_horizon_invalid';
  end if;
  with schedule_days as (
    select schedule, location.hours, local_day::date service_day
    from public.operation_schedules schedule
    join public.locations location on location.id = schedule.location_id
      and location.brand_id = schedule.brand_id
    join public.brands brand on brand.id = schedule.brand_id and brand.operations
    cross join lateral generate_series(
      (target_now at time zone schedule.timezone)::date,
      ((target_now + make_interval(hours => target_horizon_hours)) at time zone schedule.timezone)::date,
      interval '1 day'
    ) local_day
    where schedule.is_enabled and local_day::date >= schedule.active_from
      and (schedule.active_until is null or local_day::date <= schedule.active_until)
  ), schedule_windows as (
    select (schedule_day.schedule).*, starts_at
    from schedule_days schedule_day
    cross join lateral app.operation_schedule_starts(
      schedule_day.schedule, schedule_day.hours, schedule_day.service_day
    ) starts_at
  ), inserted as (
    insert into public.operation_occurrences
      (brand_id, location_id, schedule_id, template_id, source, materialization_key,
       template_snapshot, scheduled_for, due_at, grace_minutes, status)
    select schedule_window.brand_id, schedule_window.location_id, schedule_window.id,
      schedule_window.template_id, 'schedule', schedule_window.id::text || ':'
        || floor(extract(epoch from schedule_window.starts_at))::bigint::text,
      app.build_operation_snapshot(schedule_window.template_id), schedule_window.starts_at,
      schedule_window.starts_at + make_interval(mins => schedule_window.due_window_minutes),
      schedule_window.grace_minutes, 'scheduled'
    from schedule_windows schedule_window
    where schedule_window.starts_at <= target_now + make_interval(hours => target_horizon_hours)
    on conflict (brand_id, materialization_key) do nothing returning id, brand_id
  ), events as (
    insert into public.operation_occurrence_events (brand_id, occurrence_id, event_type)
    select inserted.brand_id, inserted.id, 'created' from inserted returning 1
  ) select count(*) into generated_count from inserted;
  with changed as (
    update public.operation_occurrences set status = 'scheduled', claimed_by = null,
      claimed_at = null, claim_expires_at = null
    where status = 'claimed' and claim_expires_at <= target_now returning id, brand_id
  ), events as (
    insert into public.operation_occurrence_events (brand_id, occurrence_id, event_type, reason)
    select changed.brand_id, changed.id, 'released', 'claim_expired' from changed returning 1
  ) select count(*) into released_count from changed;
  with changed as (
    update public.operation_occurrences occurrence set status = 'missed'
    where occurrence.status = 'scheduled' and occurrence.schedule_id is not null
      and exists (select 1 from public.operation_occurrences successor
        where successor.schedule_id = occurrence.schedule_id
          and successor.scheduled_for > occurrence.scheduled_for
          and successor.scheduled_for <= target_now)
    returning occurrence.id, occurrence.brand_id
  ), events as (
    insert into public.operation_occurrence_events (brand_id, occurrence_id, event_type, reason)
    select changed.brand_id, changed.id, 'missed', 'superseded' from changed returning 1
  ) select count(*) into missed_count from changed;
  with recipients as (
    select occurrence.id occurrence_id, occurrence.brand_id, occurrence.location_id,
      rule.id rule_id, member.id recipient_id, channel
    from public.operation_occurrences occurrence
    join public.operation_escalation_rules rule on rule.brand_id = occurrence.brand_id
      and (rule.schedule_id is null or rule.schedule_id = occurrence.schedule_id)
    cross join lateral unnest(rule.channels) channel
    join public.brand_users member on member.brand_id = occurrence.brand_id and (
      (rule.recipient_role = 'brand_owner' and member.role = 'brand_owner')
      or (rule.recipient_role = 'location_manager' and member.role = 'location_manager'
        and occurrence.location_id = any(member.location_ids))
      or (rule.recipient_role = 'eligible_staff' and member.role in ('staff', 'location_manager')
        and occurrence.location_id = any(member.location_ids)
        and app.operation_actor_is_eligible(occurrence, member.id))
    )
    where occurrence.status in ('scheduled', 'claimed') and rule.is_active
      and target_now >= occurrence.due_at + make_interval(mins => rule.offset_minutes)
  ), inserted as (
    insert into public.operation_notification_outbox
      (brand_id, location_id, occurrence_id, escalation_rule_id, recipient_id, channel,
       status, available_at, sent_at)
    select brand_id, location_id, occurrence_id, rule_id, recipient_id, channel,
      case when channel = 'in_app' then 'sent' else 'pending' end,
      target_now, case when channel = 'in_app' then target_now else null end
    from recipients on conflict (occurrence_id, escalation_rule_id, recipient_id, channel) do nothing
    returning *
  ), notifications as (
    insert into public.operation_operator_notifications
      (brand_id, location_id, occurrence_id, recipient_id, outbox_id, notification_kind, title, body)
    select inserted.brand_id, inserted.location_id, inserted.occurrence_id, inserted.recipient_id,
      inserted.id, 'overdue', 'Operation overdue',
      coalesce(occurrence.template_snapshot->>'title', 'Scheduled operation') || ' is overdue.'
    from inserted join public.operation_occurrences occurrence on occurrence.id = inserted.occurrence_id
    where inserted.channel = 'in_app' on conflict (outbox_id) do nothing returning 1
  ) select count(*) into outbox_count from inserted;
  return jsonb_build_object('generated', generated_count, 'released', released_count,
    'missed', missed_count, 'outbox', outbox_count);
end $$;
revoke all on function public.run_operation_maintenance(timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.run_operation_maintenance(timestamptz, integer) to service_role;

create or replace function public.claim_operation_notification_batch(target_limit integer default 50)
returns setof public.operation_notification_outbox
language sql security definer set search_path = '' as $$
  with candidates as (
    select id from public.operation_notification_outbox
    where status in ('pending', 'failed') and available_at <= now() and attempt_count < 20
    order by available_at, id for update skip locked limit least(greatest(target_limit, 1), 200)
  )
  update public.operation_notification_outbox outbox set status = 'sending',
    attempt_count = outbox.attempt_count + 1, last_error = null
  from candidates where outbox.id = candidates.id returning outbox.*
$$;
revoke all on function public.claim_operation_notification_batch(integer)
  from public, anon, authenticated;
grant execute on function public.claim_operation_notification_batch(integer) to service_role;

create or replace function public.apply_operation_retention(target_now timestamptz default now())
returns jsonb language plpgsql security definer set search_path = '' as $$
declare evidence_count integer; issue_count integer; actor_count integer;
begin
  with removed as (
    delete from public.operation_step_responses response using public.operation_occurrences occurrence,
      public.operation_retention_policies policy
    where response.occurrence_id = occurrence.id and policy.brand_id = response.brand_id
      and occurrence.completed_at < target_now - make_interval(days => policy.evidence_days)
    returning 1
  ) select count(*) into evidence_count from removed;
  with scrubbed as (
    update public.operation_issues issue set description = '', resolution = '',
      reported_by = null, resolved_by = null
    from public.operation_retention_policies policy
    where policy.brand_id = issue.brand_id
      and issue.created_at < target_now - make_interval(days => policy.issue_days)
      and (issue.description <> '' or issue.resolution <> '' or issue.reported_by is not null
        or issue.resolved_by is not null) returning 1
  ) select count(*) into issue_count from scrubbed;
  with scrubbed as (
    update public.operation_occurrence_events event set actor_id = null
    from public.operation_retention_policies policy
    where policy.brand_id = event.brand_id and event.actor_id is not null
      and event.created_at < target_now - make_interval(days => policy.actor_identity_days)
    returning 1
  ) select count(*) into actor_count from scrubbed;
  return jsonb_build_object('evidenceDeleted', evidence_count, 'issuesScrubbed', issue_count,
    'actorsAnonymized', actor_count);
end $$;
revoke all on function public.apply_operation_retention(timestamptz)
  from public, anon, authenticated;
grant execute on function public.apply_operation_retention(timestamptz) to service_role;

comment on function public.claim_operation_occurrence(uuid, uuid) is
  'Atomic idempotent staff claim. The action UUID survives offline replay.';
comment on function public.complete_operation_occurrence(uuid, uuid, jsonb, text, jsonb) is
  'Atomic idempotent completion with server-side evidence, issues, and current-eligibility validation.';
comment on table public.operation_action_receipts is
  'Append-only deduplication receipts for mobile actions; unavailable to browser reads.';
