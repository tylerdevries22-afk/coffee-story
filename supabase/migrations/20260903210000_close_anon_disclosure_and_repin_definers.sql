-- Close three disclosure and escalation holes found by a security audit of the
-- release candidate. None of them needed a code change to exploit; each is
-- reachable with the publishable key that ships inside every tenant's app.
--
-- Estimated cost: catalog for-loop touches one grant per role, the ALTERs are
-- catalog-only. No table is read, rewritten, or locked. Sub-second on any tenant.

-- 1. `created_by` on a published catalog release is a `brand_users` id, and the
--    release is anon-readable so a guest app can render a menu before sign-in.
--    That makes it an account-enumeration oracle -- exactly the disclosure
--    20260903170000 withheld `installed_by` to avoid. The guest path
--    (`packages/data/src/catalog.ts`) never selects it, so a column-level grant
--    removes the oracle without touching the boot path.
revoke select on public.catalog_releases from anon;
grant select (id, brand_id, version, status, manifest, created_at, published_at)
  on public.catalog_releases to anon;

-- 2. `app.custom_access_token` is the one function that mints brand_id, role and
--    location_ids, and it runs security definer as its owner under
--    supabase_auth_admin. It was left on `search_path = public, app` when
--    20260824100000 and 20260830001000 repinned eight sibling definers to ''.
--    Anyone able to create an object in `public` could shadow brand_users,
--    brands or customers and forge tenancy claims for every session on the
--    platform. Its body already schema-qualifies every table, so pinning the
--    attribute is sufficient -- reproducing the body would risk drift.
alter function app.custom_access_token(jsonb) set search_path = '';

-- The precondition for that attack, closed independently: nothing in the
-- migration set ever revoked CREATE on public, so the default PUBLIC grant
-- stood. Revoking it means a shadowing object cannot be created in the first
-- place, which also protects every other definer that resolves through public.
revoke create on schema public from public, anon, authenticated;

-- 3. Three definers still carried `search_path = public, app` in final state.
--    signal_brand_config_change is a trigger on public.brands that fires on
--    every config write; 20260824100000 repinned its two sibling signal
--    triggers and missed this one because it was added later.
alter function app.signal_brand_config_change() set search_path = '';

-- Readiness assertion. These are catalog facts, so the gate can state them
-- directly: a later migration that recreates any of them fails the release
-- rather than silently reopening the hole.
create or replace function app.assert_anon_disclosure_closed()
returns void language plpgsql stable security invoker set search_path = '' as $$
begin
  if exists (
    select 1 from information_schema.column_privileges
    where grantee = 'anon' and table_schema = 'public'
      and table_name = 'catalog_releases' and column_name = 'created_by'
  ) then
    raise exception 'anon can read catalog_releases.created_by again';
  end if;
  if exists (
    select 1 from pg_catalog.pg_proc proc
    join pg_catalog.pg_namespace ns on ns.oid = proc.pronamespace
    where ns.nspname = 'app'
      and proc.proname in ('custom_access_token', 'signal_brand_config_change')
      and not coalesce(proc.proconfig, '{}') @> array['search_path=']
  ) then
    raise exception 'a claims or signal definer lost its empty search_path';
  end if;
  if has_schema_privilege('anon', 'public', 'CREATE')
    or has_schema_privilege('authenticated', 'public', 'CREATE') then
    raise exception 'CREATE on schema public is granted to a client role again';
  end if;
end $$;
revoke all on function app.assert_anon_disclosure_closed() from public, anon, authenticated;
grant execute on function app.assert_anon_disclosure_closed() to service_role;

select app.register_release(
  '20260903210000',
  'close the catalog_releases account oracle, repin the claims hook, revoke CREATE on public',
  'app.assert_anon_disclosure_closed()'::regprocedure
);
