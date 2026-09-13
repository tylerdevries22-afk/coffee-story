-- An offboarded platform admin keeps cross-tenant read until their token
-- expires, because app.is_platform_admin() (20260722000032) answers from the
-- JWT alone: `coalesce(app.jwt_role() = 'platform_admin', false)`. config.toml
-- sets no jwt_expiry, so that is the Supabase default of 3600 seconds --
-- brands_select (20260722000019) hands the whole public.brands row, fee
-- columns included, to that claim for up to an hour after the membership
-- that granted it is gone. 78 call sites across 16 migrations trust this one
-- function, so the fix is here rather than at each site.
--
-- The operations family already solved the same problem the other way.
-- app.operation_location_access (20260903220000) re-reads public.brand_users
-- live rather than trusting the claim, "because a custom JWT claim survives
-- an offboard and the row does not." is_platform_admin needed the identical
-- shape: both the claim (cheap, no table read, rejects every non-admin token
-- outright) and a live membership row naming role = 'platform_admin' for
-- auth.uid() -- neither alone is sufficient once a membership can be revoked
-- out from under a still-valid token.
--
-- Representation, confirmed from the schema before writing this: brand_id on
-- brand_users is `not null references public.brands`, so a platform admin's
-- row always names a real brand (whichever one they were granted under --
-- app.apply_brand_member_change and app.provision_platform_organization_*
-- both insert one), and every existing reader already checks
-- `member.user_id = x and member.role = 'platform_admin'` with no brand_id
-- filter (20260831171620, 20260904010000, 20260911130000, among others).
-- This migration follows that same brand-agnostic shape.
--
-- Security definer, not invoker. brand_users has RLS, and its own
-- brand_users_select policy (20260825000444) leads with
-- `app.is_brand_owner(brand_id)`, which itself calls is_platform_admin().
-- An invoker-mode is_platform_admin() reading brand_users would re-enter that
-- policy on every row it considered, which calls is_brand_owner, which calls
-- is_platform_admin again -- unbounded mutual recursion, not a slow query. A
-- security definer function runs as its owner, which is exempt from RLS on
-- tables it owns by default (nothing here sets FORCE ROW LEVEL SECURITY on
-- brand_users), so the lookup below never re-enters any policy. Checked the
-- other direction too: neither brand_users trigger (validate_brand_user_locations,
-- protect_platform_admin_grant) calls is_platform_admin, so there is no
-- second recursion path through them.
--
-- The CASE keeps the short-circuit explicit rather than relying on AND's
-- evaluation order, which the planner is free to reorder: a non-admin token
-- (the overwhelming majority of calls -- every guest and every non-platform
-- staff request) returns false from the claim check alone and never touches
-- brand_users.
create or replace function app.is_platform_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select case
    when app.jwt_role() is distinct from 'platform_admin' then false
    else exists (
      select 1 from public.brand_users member
      where member.user_id = (select auth.uid())
        and member.role = 'platform_admin'
    )
  end
$$;

comment on function app.is_platform_admin() is
  'True only when the caller holds a platform_admin JWT claim AND a live '
  'brand_users row with that role for auth.uid() -- see 20260912060000 for '
  'why the claim alone (the pre-existing behaviour) leaves an offboarded '
  'admin with cross-tenant read until token expiry.';

-- A function body is the easiest thing in this schema to revert by accident
-- -- exactly what 20260903220000 guards against for brand_operations_enabled,
-- and the same risk applies here: a later migration that "restores" this
-- function from an older copy would silently reopen the gap with no error
-- anywhere else, since every one of the 78 call sites still compiles and
-- still returns a boolean.
create or replace function app.assert_platform_admin_is_live_membership()
returns void language plpgsql stable security invoker set search_path = '' as $$
declare
  body text;
  search_path_value text;
begin
  if pg_catalog.to_regprocedure('app.is_platform_admin()') is null then
    raise exception 'app.is_platform_admin is missing';
  end if;

  body := pg_catalog.pg_get_functiondef('app.is_platform_admin()'::regprocedure);
  if body !~ 'public\.brand_users' then
    raise exception 'is_platform_admin no longer reads a live brand_users row';
  end if;
  if body !~ '''platform_admin''' or body !~ 'jwt_role' then
    raise exception 'is_platform_admin lost its cheap JWT-claim short circuit';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_proc proc
    where proc.oid = 'app.is_platform_admin()'::regprocedure and proc.prosecdef
  ) then
    raise exception 'is_platform_admin must be security definer or its own '
      'brand_users read recurses through brand_users_select';
  end if;

  select split_part(cfg, '=', 2) into search_path_value
  from unnest(coalesce((
    select proc.proconfig from pg_catalog.pg_proc proc
    where proc.oid = 'app.is_platform_admin()'::regprocedure
  ), '{}'::text[])) as cfg
  where cfg like 'search_path=%'
  limit 1;
  if coalesce(search_path_value, '(unset)') not in ('""', '') then
    raise exception 'is_platform_admin is security definer without a pinned '
      'empty search_path: %', coalesce(search_path_value, '(unset)');
  end if;

  -- The 78 call sites depend on every role that could reach them still being
  -- able to call this function at all; nothing in this migration revokes
  -- execute, but a later one narrowing it would break brands_select for anon.
  if not has_function_privilege('authenticated', 'app.is_platform_admin()', 'execute') then
    raise exception 'authenticated can no longer call is_platform_admin';
  end if;
end $$;

revoke all on function app.assert_platform_admin_is_live_membership()
  from public, anon, authenticated;
grant execute on function app.assert_platform_admin_is_live_membership() to service_role;

select app.register_release(
  '20260912060000',
  'is_platform_admin requires a live brand_users membership in addition to the JWT claim, closing the window where an offboarded admin keeps cross-tenant read until token expiry',
  'app.assert_platform_admin_is_live_membership()'::regprocedure
);
