-- The anon-disclosure assertion could never pass, so the release gate has been
-- red since 20260903210000 landed.
--
-- `app.assert_anon_disclosure_closed()` asserts that the claims hook and the
-- brand-config signal trigger still carry an empty `search_path`, and tests it
-- with `proconfig @> array['search_path=']`. PostgreSQL does not store it that
-- way. `set search_path = ''` is recorded as the *quoted* empty string, so the
-- catalog holds `search_path=""` and the containment test is false for every
-- function that has the setting -- including both functions the migration had
-- just repinned. The predicate is negated, so a false test raises, and
-- `public.platform_release_readiness()` raises with it.
--
-- Verified on PostgreSQL 17.10: `set search_path = ''` written either in
-- `create function` or in `alter function` yields `{"search_path=\"\""}` in
-- both cases; the unquoted form the assertion looks for is not a serialization
-- PostgreSQL ever produces. Confirmed against this repository's own chain,
-- where the head raised `a claims or signal definer lost its empty search_path`
-- while both functions in fact had the empty setting.
--
-- Two migrations already had this right -- 20260830002000:56 and
-- 20260830010000:229 both compare against `'search_path=""'` -- so the fix is
-- to rejoin the idiom the repository already uses, and to stop depending on
-- the exact spelling at all: read the setting's value and check that it is
-- empty, which holds under either quoting.
--
-- Estimated cost: one catalog function replaced. No table read, rewritten or
-- locked; no lock held beyond the statement. Sub-second on any tenant.

create or replace function app.assert_anon_disclosure_closed()
returns void language plpgsql stable security invoker set search_path = '' as $$
declare
  offending text;
begin
  if exists (
    select 1 from information_schema.column_privileges
    where grantee = 'anon' and table_schema = 'public'
      and table_name = 'catalog_releases' and column_name = 'created_by'
  ) then
    raise exception 'anon can read catalog_releases.created_by again';
  end if;

  -- An empty search_path serializes as `search_path=""`, so match on the
  -- setting's value rather than on the whole entry: a function with no
  -- search_path at all yields no row and is reported as unpinned, and one
  -- pinned to a real schema yields that schema's name.
  select string_agg(proc.proname || ' -> ' || coalesce(found.value, '(unset)'), ', ')
    into offending
  from pg_catalog.pg_proc proc
  join pg_catalog.pg_namespace ns on ns.oid = proc.pronamespace
  left join lateral (
    select split_part(cfg, '=', 2) as value
    from unnest(coalesce(proc.proconfig, '{}'::text[])) as cfg
    where cfg like 'search_path=%'
    limit 1
  ) found on true
  where ns.nspname = 'app'
    and proc.proname in ('custom_access_token', 'signal_brand_config_change')
    and coalesce(found.value, '(unset)') not in ('""', '');

  if offending is not null then
    raise exception 'a claims or signal definer lost its empty search_path: %', offending;
  end if;

  if has_schema_privilege('anon', 'public', 'CREATE')
    or has_schema_privilege('authenticated', 'public', 'CREATE') then
    raise exception 'CREATE on schema public is granted to a client role again';
  end if;
end $$;

-- Restated because `create or replace` keeps the existing ACL but a reader
-- should not have to know that to know this function stays service-only.
revoke all on function app.assert_anon_disclosure_closed() from public, anon, authenticated;
grant execute on function app.assert_anon_disclosure_closed() to service_role;

-- Registered with no assertion of its own on purpose. 20260903210000 already
-- registers `app.assert_anon_disclosure_closed()`, and the head runs every
-- registered row, so naming it again here would evaluate the same catalog
-- facts twice on every call -- and `apps/hq/lib/deep-health.ts` calls the head
-- on every deep-health probe. The row still has to exist for the head to
-- report this release as the newest one.
select app.register_release(
  '20260904005000',
  'the anon-disclosure assertion matches how PostgreSQL serializes an empty search_path'
);
