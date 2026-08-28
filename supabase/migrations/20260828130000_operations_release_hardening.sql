-- Close the final hosted operations gaps found by the independent release review.
-- This migration is forward-only because the preceding runtime migration is
-- already applied to the Coffee Story project.

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
      and shift.starts_at <= now()
      and shift.ends_at > now()
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

create or replace function app.operation_queue_eligibility(target_occurrences uuid[])
returns table (occurrence_id uuid, eligibility jsonb)
language plpgsql stable security definer set search_path = '' as $$
declare actor public.brand_users;
begin
  if target_occurrences is null or cardinality(target_occurrences) > 1000 then
    raise exception using errcode = '22023', message = 'operation_queue_scope_invalid';
  end if;
  select * into actor from public.brand_users member
    where member.brand_id = app.jwt_brand_id() and member.user_id = (select auth.uid());
  if actor.id is null or not app.operation_brand_staff(actor.brand_id) then return; end if;
  return query
  select occurrence.id,
    jsonb_build_object(
      'eligible', shift_state.active and cardinality(role_state.missing) = 0
        and cardinality(competency_state.missing) = 0,
      'hasActiveShift', shift_state.active,
      'missingRoles', to_jsonb(role_state.missing),
      'missingCompetencies', to_jsonb(competency_state.missing)
    )
  from public.operation_occurrences occurrence
  cross join lateral (
    select exists (
      select 1 from public.shifts shift
      where shift.brand_id = occurrence.brand_id and shift.location_id = occurrence.location_id
        and shift.brand_user_id = actor.id and shift.starts_at <= now() and shift.ends_at > now()
        and shift.starts_at < occurrence.due_at and shift.ends_at > occurrence.scheduled_for
    ) active
  ) shift_state
  cross join lateral (
    select case when cardinality(required.ids) = 0 or exists (
      select 1 from public.workforce_role_assignments assignment
      join public.workforce_roles role on role.id = assignment.workforce_role_id
        and role.brand_id = assignment.brand_id and role.is_active
      where assignment.brand_id = occurrence.brand_id and assignment.brand_user_id = actor.id
        and (assignment.location_id is null or assignment.location_id = occurrence.location_id)
        and assignment.workforce_role_id::text = any(required.ids)
    ) then array[]::text[] else required.ids end missing
    from (select array(select jsonb_array_elements_text(
      coalesce(occurrence.template_snapshot->'requiredRoleIds', '[]'::jsonb)
    )) ids) required
  ) role_state
  cross join lateral (
    select coalesce(array_agg(required.key order by required.key)
      filter (where competency.id is null), array[]::text[]) missing
    from jsonb_array_elements_text(coalesce(
      occurrence.template_snapshot->'requiredCompetencyKeys', '[]'::jsonb
    )) required(key)
    left join public.training_competencies competency
      on competency.brand_id = occurrence.brand_id and competency.competency_key = required.key
      and competency.is_active and exists (
        select 1 from public.training_competency_awards award
        where award.brand_id = occurrence.brand_id and award.competency_id = competency.id
          and award.brand_user_id = actor.id and award.revoked_at is null
          and (award.expires_at is null or award.expires_at > now())
      )
  ) competency_state
  where occurrence.id = any(target_occurrences)
    and occurrence.brand_id = actor.brand_id
    and app.operation_location_access(occurrence.brand_id, occurrence.location_id);
end $$;
revoke all on function app.operation_queue_eligibility(uuid[]) from public, anon;
grant execute on function app.operation_queue_eligibility(uuid[]) to authenticated;

create or replace function public.operation_queue_eligibility(target_occurrences uuid[])
returns table (occurrence_id uuid, eligibility jsonb)
language sql security invoker set search_path = '' as $$
  select * from app.operation_queue_eligibility(target_occurrences)
$$;
revoke all on function public.operation_queue_eligibility(uuid[]) from public, anon;
grant execute on function public.operation_queue_eligibility(uuid[]) to authenticated;

create or replace function app.complete_operation_occurrence(
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
  if selected.claimed_by is distinct from actor.id or selected.status <> 'claimed'
    or selected.claim_expires_at is null or selected.claim_expires_at <= now() then
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
revoke all on function app.complete_operation_occurrence(uuid, uuid, jsonb, text, jsonb)
  from public, anon;

create or replace function public.queue_due_operation_escalations(target_now timestamptz default now())
returns integer language plpgsql security definer set search_path = '' as $$
declare inserted_count integer;
begin
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
    where occurrence.status in ('scheduled', 'claimed', 'missed') and rule.is_active
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
  ) select count(*) into inserted_count from inserted;
  return inserted_count;
end $$;
revoke all on function public.queue_due_operation_escalations(timestamptz)
  from public, anon, authenticated;
grant execute on function public.queue_due_operation_escalations(timestamptz) to service_role;

create or replace function public.claim_operation_notification_batch(target_limit integer default 50)
returns setof public.operation_notification_outbox
language sql security definer set search_path = '' as $$
  with candidates as (
    select id from public.operation_notification_outbox
    where status in ('pending', 'failed', 'sending') and available_at <= now() and attempt_count < 20
    order by available_at, id for update skip locked limit least(greatest(target_limit, 1), 200)
  )
  update public.operation_notification_outbox outbox set status = 'sending',
    attempt_count = outbox.attempt_count + 1, last_error = null,
    available_at = now() + interval '5 minutes'
  from candidates where outbox.id = candidates.id returning outbox.*
$$;
revoke all on function public.claim_operation_notification_batch(integer)
  from public, anon, authenticated;
grant execute on function public.claim_operation_notification_batch(integer) to service_role;

comment on function public.operation_queue_eligibility(uuid[]) is
  'RLS-scoped current-shift, role, and competency projection for an operator queue batch.';
comment on function public.queue_due_operation_escalations(timestamptz) is
  'Idempotently catches due escalations, including occurrences terminalized as missed.';

create or replace function public.platform_release_readiness()
returns text language plpgsql security invoker set search_path = '' as $$
begin
  if app.platform_release_readiness() <> '20260828104000' then
    raise exception 'release prerequisite is incomplete';
  end if;
  if to_regprocedure('public.operation_queue_eligibility(uuid[])') is null
    or to_regprocedure('public.queue_due_operation_escalations(timestamptz)') is null
    or to_regprocedure('public.claim_operation_notification_batch(integer)') is null then
    raise exception 'operations release hardening is incomplete';
  end if;
  return '20260828130000';
end $$;
revoke all on function public.platform_release_readiness()
  from public, anon, authenticated;
grant execute on function public.platform_release_readiness() to service_role;
