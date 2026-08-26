-- Deep health must prove that the database release can carry a complete order
-- through the live surfaces. A generic table read used to report healthy even
-- when commit_order had not been deployed, leaving every checkout broken.
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
    select 1 from pg_catalog.pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'orders'
  ) or not exists (
    select 1 from pg_catalog.pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'board_change_signals'
  ) then
    raise exception 'required order realtime publication is missing';
  end if;

  return '20260825010000';
end $$;

revoke all on function public.platform_release_readiness()
  from public, anon, authenticated;
grant execute on function public.platform_release_readiness()
  to service_role;
