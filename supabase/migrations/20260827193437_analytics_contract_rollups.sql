-- Align persisted identifiers with @platform/analytics and add hosted rollup
-- orchestration. The shared contract permits dotted semantic keys such as
-- `checkout.payment` and `screen.ready`.

alter table public.analytics_funnel_definitions
  drop constraint analytics_funnel_definitions_funnel_key_check,
  add constraint analytics_funnel_definitions_funnel_key_check
    check (funnel_key ~ '^[a-z][a-z0-9]*([._-][a-z0-9]+)*$');

alter table public.analytics_metric_definitions
  drop constraint analytics_metric_definitions_metric_key_check,
  add constraint analytics_metric_definitions_metric_key_check
    check (metric_key ~ '^[a-z][a-z0-9]*([._-][a-z0-9]+)*$');

alter table public.analytics_events
  drop constraint analytics_events_flow_key_check,
  drop constraint analytics_events_step_key_check,
  drop constraint analytics_events_metric_key_check,
  add constraint analytics_events_flow_key_check
    check (flow_key is null or flow_key ~ '^[a-z][a-z0-9]*([._-][a-z0-9]+)*$'),
  add constraint analytics_events_step_key_check
    check (step_key is null or step_key ~ '^[a-z][a-z0-9]*([._-][a-z0-9]+)*$'),
  add constraint analytics_events_metric_key_check
    check (metric_key is null or metric_key ~ '^[a-z][a-z0-9]*([._-][a-z0-9]+)*$');

alter table public.analytics_hourly_rollups
  drop constraint analytics_hourly_rollups_metric_key_check,
  add constraint analytics_hourly_rollups_metric_key_check
    check (metric_key ~ '^[a-z][a-z0-9]*([._-][a-z0-9]+)*$');

alter table public.analytics_daily_rollups
  drop constraint analytics_daily_rollups_metric_key_check,
  add constraint analytics_daily_rollups_metric_key_check
    check (metric_key ~ '^[a-z][a-z0-9]*([._-][a-z0-9]+)*$');

create table app_private.analytics_retention_runs (
  id uuid primary key default gen_random_uuid(),
  raw_before timestamptz not null,
  hourly_before timestamptz not null,
  daily_before date not null,
  raw_deleted bigint not null check (raw_deleted >= 0),
  idempotency_deleted bigint not null check (idempotency_deleted >= 0),
  hourly_deleted bigint not null check (hourly_deleted >= 0),
  daily_deleted bigint not null check (daily_deleted >= 0),
  completed_at timestamptz not null default now()
);

alter table app_private.analytics_retention_runs enable row level security;
alter table app_private.analytics_retention_runs force row level security;
create policy analytics_retention_runs_service on app_private.analytics_retention_runs
  for all to service_role using (true) with check (true);
revoke all on table app_private.analytics_retention_runs from public, anon, authenticated;
grant all on table app_private.analytics_retention_runs to service_role;

create or replace function public.refresh_analytics_rollups(
  rebuild_from timestamptz default now() - interval '48 hours'
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  bounded_from timestamptz;
  hourly_written bigint;
  daily_written bigint;
begin
  if rebuild_from > now() or rebuild_from < now() - interval '90 days' then
    raise exception using errcode = '22023', message = 'analytics_rollup_window_invalid';
  end if;
  bounded_from := date_trunc('hour', rebuild_from);
  perform pg_advisory_xact_lock(hashtextextended('analytics-rollups', 0));

  delete from public.analytics_hourly_rollups
   where bucket_start >= bounded_from;

  insert into public.analytics_hourly_rollups (
    brand_id, location_id, surface, bucket_start, metric_key,
    event_count, unique_actors, success_count, failure_count,
    duration_p50_ms, duration_p95_ms, computed_at
  )
  select event.brand_id,
         event.location_id,
         event.surface,
         date_trunc('hour', event.occurred_at),
         coalesce(event.metric_key, event.event_key),
         count(*),
         count(distinct coalesce(event.actor_hash, event.session_hash)),
         count(*) filter (where event.outcome = 'success'),
         count(*) filter (where event.outcome in ('failure', 'abandoned')),
         (percentile_cont(0.5) within group (order by event.duration_ms)
           filter (where event.duration_ms is not null))::integer,
         (percentile_cont(0.95) within group (order by event.duration_ms)
           filter (where event.duration_ms is not null))::integer,
         now()
    from public.analytics_events event
   where event.occurred_at >= bounded_from
   group by event.brand_id, event.location_id, event.surface,
            date_trunc('hour', event.occurred_at),
            coalesce(event.metric_key, event.event_key);
  get diagnostics hourly_written = row_count;

  delete from public.analytics_daily_rollups
   where day >= bounded_from::date;

  insert into public.analytics_daily_rollups (
    brand_id, location_id, surface, day, metric_key,
    event_count, unique_actors, success_count, failure_count,
    duration_p50_ms, duration_p95_ms, computed_at
  )
  select event.brand_id,
         event.location_id,
         event.surface,
         event.occurred_at::date,
         coalesce(event.metric_key, event.event_key),
         count(*),
         count(distinct coalesce(event.actor_hash, event.session_hash)),
         count(*) filter (where event.outcome = 'success'),
         count(*) filter (where event.outcome in ('failure', 'abandoned')),
         (percentile_cont(0.5) within group (order by event.duration_ms)
           filter (where event.duration_ms is not null))::integer,
         (percentile_cont(0.95) within group (order by event.duration_ms)
           filter (where event.duration_ms is not null))::integer,
         now()
    from public.analytics_events event
   where event.occurred_at >= bounded_from::date
   group by event.brand_id, event.location_id, event.surface,
            event.occurred_at::date,
            coalesce(event.metric_key, event.event_key);
  get diagnostics daily_written = row_count;

  return jsonb_build_object(
    'from', bounded_from,
    'hourlyWritten', hourly_written,
    'dailyWritten', daily_written
  );
end $$;

revoke all on function public.refresh_analytics_rollups(timestamptz)
  from public, anon, authenticated;
grant execute on function public.refresh_analytics_rollups(timestamptz)
  to service_role;

create or replace function public.prune_analytics_retention(
  raw_before timestamptz,
  hourly_before timestamptz,
  daily_before date
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  raw_deleted bigint;
  idempotency_deleted bigint;
  hourly_deleted bigint;
  daily_deleted bigint;
begin
  if raw_before > now() - interval '30 days'
     or hourly_before > now() - interval '30 days'
     or daily_before > current_date - interval '1 month' then
    raise exception using errcode = '22023', message = 'analytics_retention_cutoff_too_recent';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('analytics-retention', 0));
  delete from public.analytics_events where occurred_at < raw_before;
  get diagnostics raw_deleted = row_count;
  delete from app_private.analytics_event_idempotency where event_occurred_at < raw_before;
  get diagnostics idempotency_deleted = row_count;
  delete from public.analytics_hourly_rollups where bucket_start < hourly_before;
  get diagnostics hourly_deleted = row_count;
  delete from public.analytics_daily_rollups where day < daily_before;
  get diagnostics daily_deleted = row_count;

  insert into app_private.analytics_retention_runs (
    raw_before, hourly_before, daily_before, raw_deleted,
    idempotency_deleted, hourly_deleted, daily_deleted
  ) values (
    raw_before, hourly_before, daily_before, raw_deleted,
    idempotency_deleted, hourly_deleted, daily_deleted
  );

  return jsonb_build_object(
    'rawDeleted', raw_deleted,
    'idempotencyDeleted', idempotency_deleted,
    'hourlyDeleted', hourly_deleted,
    'dailyDeleted', daily_deleted
  );
end $$;

revoke all on function public.prune_analytics_retention(timestamptz, timestamptz, date)
  from public, anon, authenticated;
grant execute on function public.prune_analytics_retention(timestamptz, timestamptz, date)
  to service_role;
