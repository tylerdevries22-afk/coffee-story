-- Close the release-review findings without weakening tenant isolation.
-- Device registrations retain history, but a physical Expo token can have
-- only one active tenant/member owner at a time.
with ranked_devices as (
  select id, row_number() over (
    partition by expo_push_token order by updated_at desc, id desc
  ) device_rank
  from public.operation_staff_devices
  where is_active
)
update public.operation_staff_devices device set is_active = false
from ranked_devices ranked
where device.id = ranked.id and ranked.device_rank > 1;

create unique index operation_devices_active_token_key
  on public.operation_staff_devices (expo_push_token) where is_active;

create or replace function app.register_operation_device(
  target_action_id uuid,
  target_expo_push_token text,
  target_platform text
) returns public.operation_staff_devices
language plpgsql security definer set search_path = '' as $$
declare actor public.brand_users; selected public.operation_staff_devices;
  normalized_token text := btrim(target_expo_push_token);
begin
  select * into actor from public.brand_users member
    where member.brand_id = app.jwt_brand_id() and member.user_id = (select auth.uid());
  if actor.id is null or not app.operation_brand_staff(actor.brand_id) then
    raise exception using errcode = '42501', message = 'operation_actor_not_found';
  end if;
  if length(normalized_token) not between 10 and 512
    or target_platform not in ('ios', 'android') then
    raise exception using errcode = '22023', message = 'operation_device_invalid';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(normalized_token, 0)
  );
  select * into selected from public.operation_staff_devices
    where brand_id = actor.brand_id and brand_user_id = actor.id
      and last_action_id = target_action_id;
  if found then
    if selected.expo_push_token <> normalized_token
      or selected.platform <> target_platform then
      raise exception using errcode = '22023', message = 'operation_action_id_conflict';
    end if;
    return selected;
  end if;
  update public.operation_staff_devices set is_active = false
    where expo_push_token = normalized_token and is_active
      and (brand_id <> actor.brand_id or brand_user_id <> actor.id);
  insert into public.operation_staff_devices
    (brand_id, brand_user_id, expo_push_token, platform, last_action_id)
    values (actor.brand_id, actor.id, normalized_token, target_platform, target_action_id)
    on conflict (brand_id, expo_push_token) do update set
      brand_user_id = excluded.brand_user_id, platform = excluded.platform,
      is_active = true, last_action_id = excluded.last_action_id
    returning * into selected;
  return selected;
end $$;
revoke all on function app.register_operation_device(uuid, text, text)
  from public, anon;

-- Maintenance owns occurrence lifecycle only. The separately reviewed
-- queue_due_operation_escalations function is now the sole escalation writer.
create or replace function public.run_operation_maintenance(
  target_now timestamptz default now(),
  target_horizon_hours integer default 840
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare generated_count integer := 0; released_count integer := 0;
  missed_count integer := 0;
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
    update public.operation_occurrences occurrence set status = 'scheduled', claimed_by = null,
      claimed_at = null, claim_expires_at = null
    where occurrence.status = 'claimed' and occurrence.claim_expires_at <= target_now
      and exists (select 1 from public.brands brand
        where brand.id = occurrence.brand_id and brand.operations)
    returning occurrence.id, occurrence.brand_id
  ), events as (
    insert into public.operation_occurrence_events (brand_id, occurrence_id, event_type, reason)
    select changed.brand_id, changed.id, 'released', 'claim_expired' from changed returning 1
  ) select count(*) into released_count from changed;
  with changed as (
    update public.operation_occurrences occurrence set status = 'missed'
    where occurrence.status = 'scheduled' and occurrence.schedule_id is not null
      and exists (select 1 from public.brands brand
        where brand.id = occurrence.brand_id and brand.operations)
      and exists (select 1 from public.operation_occurrences successor
        where successor.schedule_id = occurrence.schedule_id
          and successor.scheduled_for > occurrence.scheduled_for
          and successor.scheduled_for <= target_now)
    returning occurrence.id, occurrence.brand_id
  ), events as (
    insert into public.operation_occurrence_events (brand_id, occurrence_id, event_type, reason)
    select changed.brand_id, changed.id, 'missed', 'superseded' from changed returning 1
  ) select count(*) into missed_count from changed;
  return jsonb_build_object('generated', generated_count, 'released', released_count,
    'missed', missed_count, 'outbox', 0);
end $$;
revoke all on function public.run_operation_maintenance(timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.run_operation_maintenance(timestamptz, integer) to service_role;

-- Chain the exact prior release contract so web deployment cannot race ahead
-- of these isolation and lifecycle repairs.
alter function public.platform_release_readiness()
  rename to platform_release_readiness_20260828130000;
alter function public.platform_release_readiness_20260828130000() set schema app;
revoke all on function app.platform_release_readiness_20260828130000()
  from public, anon, authenticated;
grant execute on function app.platform_release_readiness_20260828130000() to service_role;

create or replace function public.platform_release_readiness()
returns text language plpgsql stable security invoker set search_path = '' as $$
begin
  if app.platform_release_readiness_20260828130000() <> '20260828130000' then
    raise exception 'prior operations release contract is missing';
  end if;
  if to_regclass('public.operation_devices_active_token_key') is null then
    raise exception 'active operation device isolation is incomplete';
  end if;
  return '20260828144328';
end $$;
revoke all on function public.platform_release_readiness()
  from public, anon, authenticated;
grant execute on function public.platform_release_readiness() to service_role;
