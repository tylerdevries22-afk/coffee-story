-- Views execute with their owner's privileges unless explicitly configured as
-- security invokers. Keep the platform-only predicate, security barrier, and
-- existing grants intact while making the underlying brands/locations reads
-- obey the caller's privileges and RLS policies.
alter view public.brand_directory set (security_invoker = true);

-- Extend the fail-closed deployment chain. Besides proving the migration ran,
-- check the live catalog so a later option change cannot make the release
-- probe report healthy while this view has fallen back to definer semantics.
alter function public.platform_release_readiness()
  rename to platform_release_readiness_20260831072451;
alter function public.platform_release_readiness_20260831072451() set schema app;
revoke all on function app.platform_release_readiness_20260831072451()
  from public, anon, authenticated;
grant execute on function app.platform_release_readiness_20260831072451()
  to service_role;

create or replace function public.platform_release_readiness()
returns text language plpgsql stable security invoker set search_path = '' as $$
begin
  if app.platform_release_readiness_20260831072451() <> '20260831072451' then
    raise exception 'Square access-token retirement readiness prerequisite is incomplete';
  end if;
  if not exists (
    select 1
      from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
     where namespace.nspname = 'public'
       and relation.relname = 'brand_directory'
       and relation.relkind = 'v'
       and coalesce(relation.reloptions, '{}'::text[])
         @> array['security_barrier=true', 'security_invoker=true']
  ) then
    raise exception 'brand_directory is missing its security barrier or invoker policy';
  end if;
  return '20260831121801';
end $$;
revoke all on function public.platform_release_readiness()
  from public, anon, authenticated;
grant execute on function public.platform_release_readiness()
  to service_role;
