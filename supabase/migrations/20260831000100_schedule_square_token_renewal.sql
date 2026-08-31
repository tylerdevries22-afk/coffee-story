-- The five-minute maintenance tick scans only authorizations whose retry
-- cooldown has elapsed, then checks expiry. Keep that bounded scan off the
-- table as the franchise fleet grows; rows without refresh credentials can
-- never be renewed and do not belong in the index.
create index square_connections_renewal_due_idx
  on public.square_connections (updated_at, expires_at)
  where refresh_token_encrypted is not null;

-- Extend the fail-closed deployment chain. The application advertises this
-- migration as its minimum database release, so readiness must prove both the
-- preceding release and this migration's operational contract.
alter function public.platform_release_readiness()
  rename to platform_release_readiness_20260831000000;
alter function public.platform_release_readiness_20260831000000() set schema app;
revoke all on function app.platform_release_readiness_20260831000000()
  from public, anon, authenticated;
grant execute on function app.platform_release_readiness_20260831000000()
  to service_role;

create or replace function public.platform_release_readiness()
returns text language plpgsql stable security invoker set search_path = '' as $$
begin
  if app.platform_release_readiness_20260831000000() <> '20260831000000' then
    raise exception 'brand-directory readiness prerequisite is incomplete';
  end if;
  if pg_catalog.to_regclass('public.square_connections_renewal_due_idx') is null then
    raise exception 'Square token renewal index is missing';
  end if;
  return '20260831000100';
end $$;
revoke all on function public.platform_release_readiness()
  from public, anon, authenticated;
grant execute on function public.platform_release_readiness()
  to service_role;
