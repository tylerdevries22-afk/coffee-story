-- Repair the volatility metadata of an already-applied readiness link without
-- rewriting migration history. Every function in the chain performs catalog
-- reads only, so STABLE is accurate and preserves read-only PostgREST calls.
alter function app.platform_release_readiness_20260828130000() stable;

alter function public.platform_release_readiness()
  rename to platform_release_readiness_20260828144328;
alter function public.platform_release_readiness_20260828144328() set schema app;
revoke all on function app.platform_release_readiness_20260828144328()
  from public, anon, authenticated;
grant execute on function app.platform_release_readiness_20260828144328() to service_role;

create or replace function public.platform_release_readiness()
returns text language plpgsql stable security invoker set search_path = '' as $$
begin
  if app.platform_release_readiness_20260828144328() <> '20260828144328' then
    raise exception 'prior operations review contract is missing';
  end if;
  return '20260828152200';
end $$;
revoke all on function public.platform_release_readiness()
  from public, anon, authenticated;
grant execute on function public.platform_release_readiness() to service_role;
