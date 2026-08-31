-- Generic tenant operations. Industry procedures belong to tenant data, never
-- this migration. Occurrences snapshot mutable templates so evidence remains
-- reviewable after a franchise or location changes its standard.

create type app.operation_occurrence_status as enum (
<<<<<<< ours
  'scheduled', 'claimed', 'completed', 'missed', 'cancelled'
=======
  'upcoming', 'due', 'claimed', 'completed', 'overdue', 'waived', 'cancelled'
>>>>>>> theirs
);

alter table public.brands add column operations boolean not null default false;

create table public.operation_task_templates (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  location_id uuid,
<<<<<<< ours
  program_key text not null default 'general'
    check (program_key ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  template_key text not null check (template_key ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  routine_kind text not null default 'ad_hoc'
    check (routine_kind in ('opening', 'interval', 'closing', 'ad_hoc')),
=======
  template_key text not null check (template_key ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
>>>>>>> theirs
  revision integer not null default 1 check (revision > 0),
  title text not null check (length(btrim(title)) between 1 and 200),
  instructions text not null default '',
  estimated_minutes smallint not null default 10 check (estimated_minutes between 1 and 1440),
  required_role_ids uuid[] not null default '{}',
  required_competency_keys text[] not null default '{}',
  evidence_policy jsonb not null default '{"note":"optional"}'::jsonb
    check (jsonb_typeof(evidence_policy) = 'object'),
  brand_template_id uuid,
  is_active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (location_id, brand_id) references public.locations (id, brand_id) on delete cascade,
  foreign key (brand_template_id, brand_id)
    references public.operation_task_templates (id, brand_id) on delete set null (brand_template_id),
  foreign key (created_by, brand_id) references public.brand_users (id, brand_id) on delete set null (created_by),
  unique nulls not distinct (brand_id, location_id, template_key, revision),
  unique (id, brand_id)
);

create table public.operation_task_steps (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  template_id uuid not null,
  step_key text not null check (step_key ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  title text not null check (length(btrim(title)) between 1 and 200),
  instructions text not null default '',
  response_kind text not null default 'confirm'
    check (response_kind in ('confirm', 'pass_fail', 'number', 'text')),
  is_required boolean not null default true,
  issue_on_failure boolean not null default false,
<<<<<<< ours
  allow_not_applicable boolean not null default false,
=======
>>>>>>> theirs
  constraints jsonb not null default '{}'::jsonb check (jsonb_typeof(constraints) = 'object'),
  sort_order integer not null default 0,
  foreign key (template_id, brand_id) references public.operation_task_templates (id, brand_id) on delete cascade,
  unique (template_id, step_key),
  unique (id, brand_id)
);

create table public.operation_schedules (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  location_id uuid not null,
  template_id uuid not null,
  timezone text not null,
  recurrence_rule text not null check (length(btrim(recurrence_rule)) between 1 and 500),
  local_start_time time not null,
  due_window_minutes smallint not null default 30 check (due_window_minutes between 1 and 1440),
  grace_minutes smallint not null default 10 check (grace_minutes between 0 and 1440),
  active_from date not null default current_date,
  active_until date,
  is_enabled boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (active_until is null or active_until >= active_from),
  foreign key (location_id, brand_id) references public.locations (id, brand_id) on delete cascade,
  foreign key (template_id, brand_id) references public.operation_task_templates (id, brand_id) on delete restrict,
  foreign key (created_by, brand_id) references public.brand_users (id, brand_id) on delete set null (created_by),
  unique (id, brand_id)
);

create table public.operation_occurrences (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  location_id uuid not null,
  schedule_id uuid,
  template_id uuid not null,
  source text not null default 'schedule' check (source in ('schedule', 'manual', 'event')),
  materialization_key text not null,
  template_snapshot jsonb not null check (jsonb_typeof(template_snapshot) = 'object'),
  scheduled_for timestamptz not null,
  due_at timestamptz not null,
<<<<<<< ours
  status app.operation_occurrence_status not null default 'scheduled',
=======
  status app.operation_occurrence_status not null default 'upcoming',
>>>>>>> theirs
  claimed_by uuid,
  claimed_at timestamptz,
  completed_at timestamptz,
  completion_note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (due_at > scheduled_for),
  check ((status = 'claimed') = (claimed_by is not null and claimed_at is not null) or status <> 'claimed'),
  foreign key (location_id, brand_id) references public.locations (id, brand_id) on delete cascade,
  foreign key (schedule_id, brand_id) references public.operation_schedules (id, brand_id) on delete set null (schedule_id),
  foreign key (template_id, brand_id) references public.operation_task_templates (id, brand_id) on delete restrict,
  foreign key (claimed_by, brand_id) references public.brand_users (id, brand_id) on delete set null (claimed_by),
  unique (brand_id, materialization_key),
  unique (id, brand_id)
);

create table public.operation_occurrence_events (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  occurrence_id uuid not null,
  event_type text not null check (event_type in (
<<<<<<< ours
    'created', 'claimed', 'released', 'completed', 'missed',
    'cancelled', 'corrected', 'issue_reported', 'issue_acknowledged', 'issue_resolved',
    'issue_dismissed'
=======
    'created', 'due', 'claimed', 'released', 'completed', 'overdue',
    'waived', 'cancelled', 'corrected', 'issue_reported', 'issue_resolved'
>>>>>>> theirs
  )),
  actor_id uuid,
  reason text not null default '',
  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object'),
  created_at timestamptz not null default now(),
  foreign key (occurrence_id, brand_id) references public.operation_occurrences (id, brand_id) on delete cascade,
  foreign key (actor_id, brand_id) references public.brand_users (id, brand_id) on delete set null (actor_id)
);

create table public.operation_step_responses (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  occurrence_id uuid not null,
  step_key text not null,
  response jsonb not null,
  responded_by uuid not null,
  responded_at timestamptz not null default now(),
  foreign key (occurrence_id, brand_id) references public.operation_occurrences (id, brand_id) on delete cascade,
  foreign key (responded_by, brand_id) references public.brand_users (id, brand_id) on delete restrict,
  unique (occurrence_id, step_key)
);

create table public.operation_issues (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  location_id uuid not null,
  occurrence_id uuid not null,
  category text not null,
  severity text not null default 'normal' check (severity in ('low', 'normal', 'high', 'urgent')),
  description text not null default '',
  status text not null default 'open' check (status in ('open', 'acknowledged', 'resolved', 'dismissed')),
  reported_by uuid not null,
  resolved_by uuid,
  resolved_at timestamptz,
  resolution text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (location_id, brand_id) references public.locations (id, brand_id) on delete cascade,
  foreign key (occurrence_id, brand_id) references public.operation_occurrences (id, brand_id) on delete cascade,
  foreign key (reported_by, brand_id) references public.brand_users (id, brand_id) on delete restrict,
  foreign key (resolved_by, brand_id) references public.brand_users (id, brand_id) on delete set null (resolved_by)
);

create table public.operation_escalation_rules (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  schedule_id uuid,
  escalation_order smallint not null check (escalation_order between 1 and 20),
  offset_minutes integer not null check (offset_minutes >= 0),
  recipient_role text not null check (recipient_role in ('eligible_staff', 'location_manager', 'brand_owner')),
<<<<<<< ours
  channels text[] not null default '{in_app}',
=======
  channels text[] not null default '{push}',
>>>>>>> theirs
  foreign key (schedule_id, brand_id) references public.operation_schedules (id, brand_id) on delete cascade,
  unique nulls not distinct (brand_id, schedule_id, escalation_order)
);

create table public.operation_notification_outbox (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  location_id uuid not null,
  occurrence_id uuid not null,
  escalation_rule_id uuid not null references public.operation_escalation_rules (id) on delete cascade,
  recipient_id uuid not null,
<<<<<<< ours
  channel text not null check (channel in ('in_app', 'push')),
=======
  channel text not null check (channel in ('push', 'sms', 'email')),
>>>>>>> theirs
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'cancelled')),
  attempt_count smallint not null default 0 check (attempt_count between 0 and 20),
  available_at timestamptz not null,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  foreign key (location_id, brand_id) references public.locations (id, brand_id) on delete cascade,
  foreign key (occurrence_id, brand_id) references public.operation_occurrences (id, brand_id) on delete cascade,
  foreign key (recipient_id, brand_id) references public.brand_users (id, brand_id) on delete cascade,
  unique (occurrence_id, escalation_rule_id, recipient_id, channel)
);

create table public.operation_retention_policies (
  brand_id uuid primary key references public.brands (id) on delete cascade,
<<<<<<< ours
  evidence_days integer not null default 395 check (evidence_days between 30 and 3650),
  issue_days integer not null default 395 check (issue_days between 30 and 3650),
  actor_identity_days integer not null default 395 check (actor_identity_days between 30 and 3650),
=======
  evidence_days integer not null default 365 check (evidence_days between 30 and 3650),
  issue_days integer not null default 730 check (issue_days between 30 and 3650),
  actor_identity_days integer not null default 365 check (actor_identity_days between 30 and 3650),
>>>>>>> theirs
  updated_by uuid,
  updated_at timestamptz not null default now(),
  foreign key (updated_by, brand_id) references public.brand_users (id, brand_id) on delete set null (updated_by)
);

create table public.operations_change_signals (
  location_id uuid primary key,
  brand_id uuid not null references public.brands (id) on delete cascade,
  revision bigint not null default 1,
  changed_at timestamptz not null default now(),
  foreign key (location_id, brand_id) references public.locations (id, brand_id) on delete cascade
);

create table public.training_competencies (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  competency_key text not null check (competency_key ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  title text not null check (length(btrim(title)) between 1 and 200),
  renewal_days integer check (renewal_days between 1 and 3650),
  is_active boolean not null default true,
  unique (brand_id, competency_key),
  unique (id, brand_id)
);

create table public.training_competency_awards (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  competency_id uuid not null,
  brand_user_id uuid not null,
  release_id uuid,
  module_slug text,
  lesson_slug text,
  awarded_at timestamptz not null default now(),
  expires_at timestamptz,
  awarded_by uuid,
  foreign key (competency_id, brand_id) references public.training_competencies (id, brand_id) on delete cascade,
  foreign key (brand_user_id, brand_id) references public.brand_users (id, brand_id) on delete cascade,
  foreign key (release_id, brand_id) references public.training_releases (id, brand_id) on delete restrict,
  foreign key (awarded_by, brand_id) references public.brand_users (id, brand_id) on delete set null (awarded_by),
  unique (competency_id, brand_user_id, awarded_at)
);

create index operation_occurrences_queue_idx
  on public.operation_occurrences (location_id, status, scheduled_for);
create index operation_occurrence_events_history_idx
  on public.operation_occurrence_events (occurrence_id, created_at);
create index operation_outbox_due_idx
  on public.operation_notification_outbox (status, available_at) where status in ('pending', 'failed');

create trigger operation_templates_touch before update on public.operation_task_templates
  for each row execute function app.touch_updated_at();
create trigger operation_schedules_touch before update on public.operation_schedules
  for each row execute function app.touch_updated_at();
create trigger operation_occurrences_touch before update on public.operation_occurrences
  for each row execute function app.touch_updated_at();
create trigger operation_issues_touch before update on public.operation_issues
  for each row execute function app.touch_updated_at();

alter table public.operation_task_templates enable row level security;
alter table public.operation_task_steps enable row level security;
alter table public.operation_schedules enable row level security;
alter table public.operation_occurrences enable row level security;
alter table public.operation_occurrence_events enable row level security;
alter table public.operation_step_responses enable row level security;
alter table public.operation_issues enable row level security;
alter table public.operation_escalation_rules enable row level security;
alter table public.operation_notification_outbox enable row level security;
alter table public.operation_retention_policies enable row level security;
alter table public.training_competencies enable row level security;
alter table public.training_competency_awards enable row level security;
alter table public.operations_change_signals enable row level security;

create policy operation_templates_read on public.operation_task_templates for select to authenticated
  using (app.is_brand_staff(brand_id));
create policy operation_steps_read on public.operation_task_steps for select to authenticated
  using (app.is_brand_staff(brand_id));
create policy operation_schedules_read on public.operation_schedules for select to authenticated
  using (app.at_location(brand_id, location_id) or app.is_brand_owner(brand_id));
create policy operation_occurrences_read on public.operation_occurrences for select to authenticated
  using (app.at_location(brand_id, location_id) or app.is_brand_owner(brand_id));
create policy operation_events_read on public.operation_occurrence_events for select to authenticated
  using (exists (select 1 from public.operation_occurrences occurrence
    where occurrence.id = occurrence_id and
      (app.at_location(occurrence.brand_id, occurrence.location_id) or app.is_brand_owner(occurrence.brand_id))));
create policy operation_responses_read on public.operation_step_responses for select to authenticated
  using (exists (select 1 from public.operation_occurrences occurrence
    where occurrence.id = occurrence_id and
      (app.at_location(occurrence.brand_id, occurrence.location_id) or app.is_brand_owner(occurrence.brand_id))));
create policy operation_issues_read on public.operation_issues for select to authenticated
  using (app.at_location(brand_id, location_id) or app.is_brand_owner(brand_id));
create policy operation_escalations_read on public.operation_escalation_rules for select to authenticated
  using (app.is_brand_manager(brand_id));
create policy operation_retention_read on public.operation_retention_policies for select to authenticated
  using (app.is_brand_manager(brand_id));
create policy training_competencies_read on public.training_competencies for select to authenticated
  using (app.is_brand_staff(brand_id));
create policy training_competency_awards_read on public.training_competency_awards for select to authenticated
  using (app.is_brand_manager(brand_id) or app.is_current_brand_user(brand_id, brand_user_id));
create policy operations_change_signals_read on public.operations_change_signals for select to authenticated
  using (app.at_location(brand_id, location_id) or app.is_brand_owner(brand_id));

create policy operation_templates_manage on public.operation_task_templates for all to authenticated
  using (app.is_brand_owner(brand_id) or (location_id is not null and app.manages_location(brand_id, location_id)))
  with check (app.is_brand_owner(brand_id) or (location_id is not null and app.manages_location(brand_id, location_id)));
create policy operation_steps_manage on public.operation_task_steps for all to authenticated
  using (exists (select 1 from public.operation_task_templates template
    where template.id = template_id and
      (app.is_brand_owner(template.brand_id) or
       (template.location_id is not null and app.manages_location(template.brand_id, template.location_id)))))
  with check (exists (select 1 from public.operation_task_templates template
    where template.id = template_id and
      (app.is_brand_owner(template.brand_id) or
       (template.location_id is not null and app.manages_location(template.brand_id, template.location_id)))));
create policy operation_schedules_manage on public.operation_schedules for all to authenticated
  using (app.manages_location(brand_id, location_id)) with check (app.manages_location(brand_id, location_id));
create policy operation_escalations_manage on public.operation_escalation_rules for all to authenticated
  using (app.is_brand_manager(brand_id)) with check (app.is_brand_manager(brand_id));
create policy operation_retention_manage on public.operation_retention_policies for all to authenticated
  using (app.is_brand_owner(brand_id)) with check (app.is_brand_owner(brand_id));
create policy training_competencies_manage on public.training_competencies for all to authenticated
  using (app.is_brand_owner(brand_id)) with check (app.is_brand_owner(brand_id));

revoke all on public.operation_task_templates, public.operation_task_steps,
  public.operation_schedules, public.operation_occurrences, public.operation_occurrence_events,
  public.operation_step_responses, public.operation_issues, public.operation_escalation_rules,
  public.operation_notification_outbox, public.operation_retention_policies from anon, authenticated;
revoke all on public.training_competencies, public.training_competency_awards from anon, authenticated;
revoke all on public.operations_change_signals from anon, authenticated;
grant select on public.operation_task_templates, public.operation_task_steps,
  public.operation_schedules, public.operation_occurrences, public.operation_occurrence_events,
  public.operation_step_responses, public.operation_issues, public.operation_escalation_rules,
  public.operation_retention_policies to authenticated;
grant select on public.training_competencies, public.training_competency_awards to authenticated;
grant select on public.operations_change_signals to authenticated;
grant insert, update, delete on public.operation_task_templates, public.operation_task_steps,
  public.operation_schedules, public.operation_escalation_rules to authenticated;
grant insert, update on public.operation_retention_policies to authenticated;
grant insert, update, delete on public.training_competencies to authenticated;
grant all on public.operation_task_templates, public.operation_task_steps, public.operation_schedules,
  public.operation_occurrences, public.operation_occurrence_events, public.operation_step_responses,
  public.operation_issues, public.operation_escalation_rules, public.operation_notification_outbox,
  public.operation_retention_policies to service_role;
grant all on public.training_competencies, public.training_competency_awards to service_role;
grant all on public.operations_change_signals to service_role;

create or replace function app.signal_operations_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare source_location uuid := coalesce(new.location_id, old.location_id);
  source_brand uuid := coalesce(new.brand_id, old.brand_id);
begin
  insert into public.operations_change_signals (location_id, brand_id)
  values (source_location, source_brand)
  on conflict (location_id) do update set revision = operations_change_signals.revision + 1,
    changed_at = now();
  return coalesce(new, old);
end $$;
revoke execute on function app.signal_operations_change() from public, anon, authenticated;
create trigger operation_occurrences_signal after insert or update or delete
  on public.operation_occurrences for each row execute function app.signal_operations_change();

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
    and schemaname = 'public' and tablename = 'operations_change_signals') then
    alter publication supabase_realtime add table public.operations_change_signals;
  end if;
end $$;

create or replace function public.claim_operation_occurrence(target_occurrence uuid)
returns public.operation_occurrences
language plpgsql security invoker set search_path = '' as $$
declare selected public.operation_occurrences; actor public.brand_users;
  required_competency text;
begin
  select * into selected from public.operation_occurrences where id = target_occurrence for update;
  if not found or not app.at_location(selected.brand_id, selected.location_id) then
    raise exception using errcode = '42501', message = 'operation_occurrence_not_accessible';
  end if;
  select * into actor from public.brand_users
    where brand_id = selected.brand_id and user_id = (select auth.uid());
  if not found then raise exception using errcode = '42501', message = 'operation_actor_not_found'; end if;
<<<<<<< ours
  if selected.status <> 'scheduled' or selected.scheduled_for > now() then
=======
  if selected.status not in ('upcoming', 'due', 'overdue') then
>>>>>>> theirs
    raise exception using errcode = '40001', message = 'operation_occurrence_not_claimable';
  end if;
  if jsonb_array_length(coalesce(selected.template_snapshot->'requiredRoleIds', '[]'::jsonb)) > 0
     and not exists (
       select 1 from public.workforce_role_assignments assignment
       where assignment.brand_id = selected.brand_id and assignment.brand_user_id = actor.id
         and (assignment.location_id is null or assignment.location_id = selected.location_id)
         and assignment.workforce_role_id::text in (
           select jsonb_array_elements_text(selected.template_snapshot->'requiredRoleIds')
         )
     ) then
    raise exception using errcode = '42501', message = 'operation_role_required';
  end if;
  for required_competency in
    select jsonb_array_elements_text(coalesce(selected.template_snapshot->'requiredCompetencyKeys', '[]'::jsonb))
  loop
    if not exists (
      select 1 from public.training_competency_awards award
      join public.training_competencies competency on competency.id = award.competency_id
      where award.brand_id = selected.brand_id and award.brand_user_id = actor.id
        and competency.competency_key = required_competency
        and (award.expires_at is null or award.expires_at > now())
    ) then
      raise exception using errcode = '42501', message = 'operation_training_required';
    end if;
  end loop;
  update public.operation_occurrences set status = 'claimed', claimed_by = actor.id,
    claimed_at = now() where id = selected.id returning * into selected;
  insert into public.operation_occurrence_events (brand_id, occurrence_id, event_type, actor_id)
    values (selected.brand_id, selected.id, 'claimed', actor.id);
  return selected;
end $$;

revoke all on function public.claim_operation_occurrence(uuid) from public, anon;
grant execute on function public.claim_operation_occurrence(uuid) to authenticated, service_role;

create or replace function public.complete_operation_occurrence(
  target_occurrence uuid,
  target_responses jsonb,
  target_note text default ''
) returns public.operation_occurrences
language plpgsql security invoker set search_path = '' as $$
declare selected public.operation_occurrences; actor public.brand_users; required_step jsonb;
begin
  if jsonb_typeof(target_responses) <> 'object' then
    raise exception using errcode = '22023', message = 'operation_responses_invalid';
  end if;
  select * into selected from public.operation_occurrences where id = target_occurrence for update;
  if not found or not app.at_location(selected.brand_id, selected.location_id) then
    raise exception using errcode = '42501', message = 'operation_occurrence_not_accessible';
  end if;
  select * into actor from public.brand_users
    where brand_id = selected.brand_id and user_id = (select auth.uid());
  if not found then raise exception using errcode = '42501', message = 'operation_actor_not_found'; end if;
<<<<<<< ours
  if selected.claimed_by is distinct from actor.id or selected.status <> 'claimed' then
=======
  if selected.claimed_by is distinct from actor.id or selected.status not in ('claimed', 'overdue') then
>>>>>>> theirs
    raise exception using errcode = '42501', message = 'operation_occurrence_not_owned';
  end if;
  for required_step in
    select value from jsonb_array_elements(coalesce(selected.template_snapshot->'steps', '[]'::jsonb))
    where coalesce((value->>'required')::boolean, true)
  loop
    if not target_responses ? (required_step->>'key') then
      raise exception using errcode = '22023', message = 'operation_required_response_missing';
    end if;
  end loop;
  insert into public.operation_step_responses (
    brand_id, occurrence_id, step_key, response, responded_by
  ) select selected.brand_id, selected.id, response.key, response.value, actor.id
    from jsonb_each(target_responses) response;
  update public.operation_occurrences set status = 'completed', completed_at = now(),
    completion_note = left(coalesce(target_note, ''), 2000)
    where id = selected.id returning * into selected;
  insert into public.operation_occurrence_events (brand_id, occurrence_id, event_type, actor_id)
    values (selected.brand_id, selected.id, 'completed', actor.id);
  return selected;
end $$;

revoke all on function public.complete_operation_occurrence(uuid, jsonb, text) from public, anon;
grant execute on function public.complete_operation_occurrence(uuid, jsonb, text) to authenticated, service_role;

comment on table public.operation_task_templates is
  'Tenant-authored generic operations definitions; industry-specific procedures are tenant data.';
comment on table public.operation_occurrence_events is
  'Append-only audit history. Clients receive no update or delete grant.';
