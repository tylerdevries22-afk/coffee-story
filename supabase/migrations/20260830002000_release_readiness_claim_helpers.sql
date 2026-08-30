-- Readiness link.
--
-- verify.yml derives the expected readiness from the newest migration filename,
-- so every migration extends the chain or the release gate fails closed. The
-- two migrations before this one hardened app.jwt_brand_id and
-- app.jwt_location_ids without extending it; this link covers all three.
--
-- What it asserts is the mistake the second of those repaired. A
-- `create or replace function` rewrites the whole definition, SET clauses
-- included, so any future edit to these helpers silently drops the empty
-- search_path that 20260824072313 swept across the app schema -- and drops the
-- guard that keeps a malformed claim from raising 22P02 out of every policy
-- that reads it. Both are invisible in a diff of the new definition, because
-- what went missing is not in it. The release gate is the right place to catch
-- that: it reads what is actually installed.
--
-- Shape, not text: the guards are asserted as "there is a pattern match in
-- here" rather than by matching an exact body, so the helpers can be rewritten
-- as long as they still refuse to cast something unvalidated.

alter function public.platform_release_readiness()
  rename to platform_release_readiness_20260829190000;
alter function public.platform_release_readiness_20260829190000() set schema app;
revoke all on function app.platform_release_readiness_20260829190000()
  from public, anon, authenticated;
grant execute on function app.platform_release_readiness_20260829190000()
  to service_role;

create or replace function public.platform_release_readiness()
returns text language plpgsql stable security invoker set search_path = '' as $$
declare guarded_helpers integer;
declare pinned_helpers integer;
begin
  if app.platform_release_readiness_20260829190000() <> '20260829190000' then
    raise exception 'tenant-scoped recipe readiness prerequisite is incomplete';
  end if;

  -- Both helpers validate before they cast. jwt_location_ids has the extra
  -- job of surviving a location_ids claim that is not an array at all.
  select count(*) into guarded_helpers
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'app'
    and ((p.proname = 'jwt_brand_id' and p.prosrc ~ '~\*')
      or (p.proname = 'jwt_location_ids'
          and p.prosrc ~ '~\*' and p.prosrc ~ 'jsonb_typeof'));
  if guarded_helpers <> 2 then
    raise exception 'a claim helper casts an unvalidated claim and can raise out of a policy';
  end if;

  select count(*) into pinned_helpers
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'app'
    and p.proname in ('jwt_brand_id', 'jwt_location_ids')
    and 'search_path=""' = any(p.proconfig);
  if pinned_helpers <> 2 then
    raise exception 'a claim helper lost its pinned search_path';
  end if;

  return '20260830002000';
end $$;
revoke all on function public.platform_release_readiness()
  from public, anon, authenticated;
grant execute on function public.platform_release_readiness()
  to service_role;
