-- Repair the readiness chain without rewriting applied migration history.
-- 20260828130000 replaced the public 20260828104000 wrapper instead of
-- preserving it, then compared the older 20260828095000 prerequisite to the
-- missing 20260828104000 marker. Recreate that immutable link under a
-- versioned internal name and make every later link depend on it.

create or replace function app.platform_release_readiness_20260828104000()
returns text language plpgsql stable security invoker set search_path = '' as $$
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
revoke all on function app.platform_release_readiness_20260828104000()
  from public, anon, authenticated;
grant execute on function app.platform_release_readiness_20260828104000()
  to service_role;

create or replace function app.platform_release_readiness_20260828130000()
returns text language plpgsql stable security invoker set search_path = '' as $$
begin
  if app.platform_release_readiness_20260828104000() <> '20260828104000' then
    raise exception 'release prerequisite is incomplete';
  end if;
  if pg_catalog.to_regprocedure('public.operation_queue_eligibility(uuid[])') is null
    or pg_catalog.to_regprocedure('public.queue_due_operation_escalations(timestamptz)') is null
    or pg_catalog.to_regprocedure('public.claim_operation_notification_batch(integer)') is null then
    raise exception 'operations release hardening is incomplete';
  end if;
  return '20260828130000';
end $$;
revoke all on function app.platform_release_readiness_20260828130000()
  from public, anon, authenticated;
grant execute on function app.platform_release_readiness_20260828130000()
  to service_role;

alter function public.platform_release_readiness()
  rename to platform_release_readiness_20260828163000;
alter function public.platform_release_readiness_20260828163000() set schema app;
revoke all on function app.platform_release_readiness_20260828163000()
  from public, anon, authenticated;
grant execute on function app.platform_release_readiness_20260828163000()
  to service_role;

create or replace function public.platform_release_readiness()
returns text language plpgsql stable security invoker set search_path = '' as $$
begin
  if app.platform_release_readiness_20260828163000() <> '20260828163000' then
    raise exception 'prior training competency release contract is missing';
  end if;
  if app.platform_release_readiness_20260828104000() <> '20260828104000' then
    raise exception 'repaired readiness prerequisite is incomplete';
  end if;
  return '20260828192003';
end $$;
revoke all on function public.platform_release_readiness()
  from public, anon, authenticated;
grant execute on function public.platform_release_readiness()
  to service_role;
