-- Deep health must certify the consolidated runtime contract, not merely prove
-- that an older database can still answer a generic query. Keeping the value
-- in this final forward-only migration makes a Vercel release fail closed if
-- Supabase production has not finished applying the same Git revision.
create or replace function public.platform_release_readiness()
returns text
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = 'commit_order'
      and procedure.pronargs = 18
  ) then
    raise exception 'required order commit contract is missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = 'publish_manual_training_release'
      and procedure.pronargs = 4
  ) then
    raise exception 'required bounded training publication contract is missing';
  end if;

  if pg_catalog.to_regclass('public.content_media_versions') is null
     or not exists (select 1 from storage.buckets where id = 'training-media') then
    raise exception 'required content media contract is missing';
  end if;

  if pg_catalog.to_regclass('public.operation_occurrences') is null
     or pg_catalog.to_regclass('public.operation_action_receipts') is null
     or pg_catalog.to_regclass('public.operation_operator_notifications') is null then
    raise exception 'required tenant operations tables are missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = 'claim_operation_occurrence'
      and procedure.pronargs = 2
  ) or not exists (
    select 1
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = 'cancel_operation_occurrence'
      and procedure.pronargs = 3
  ) then
    raise exception 'required tenant operations lifecycle contract is missing';
  end if;

  if pg_catalog.to_regclass('public.platform_onboarding_runs') is null
     or pg_catalog.to_regclass('public.platform_credential_requirements') is null then
    raise exception 'required platform factory contract is missing';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'orders'
  ) or not exists (
    select 1 from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'board_change_signals'
  ) or not exists (
    select 1 from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'operations_change_signals'
  ) then
    raise exception 'required realtime publication contract is missing';
  end if;

  return '20260828095000';
end $$;

revoke all on function public.platform_release_readiness()
  from public, anon, authenticated;
grant execute on function public.platform_release_readiness()
  to service_role;
