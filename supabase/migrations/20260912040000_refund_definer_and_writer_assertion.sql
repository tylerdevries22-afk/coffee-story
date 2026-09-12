-- process_square_refund's definer contract, re-verified rather than re-fixed.
--
-- The concern: 20260911180000 made process_square_refund SECURITY DEFINER
-- and registered app.assert_process_square_refund_definer(), which raises
-- unless prosecdef is true, search_path is pinned to '', and only
-- service_role can execute it. Two later migrations replace the function
-- body wholesale -- 20260911200000_activity_board_and_refund_claim.sql:136
-- and 20260911250000_fix_refund_greatest_cast.sql:11 -- as
-- `security invoker`, and CREATE OR REPLACE resets prosecdef to whatever the
-- new CREATE says. Read in isolation, that looks like exactly the
-- registered assertion failing permanently at head.
--
-- It is not, on this tree. Both of those migrations immediately follow
-- their CREATE OR REPLACE with their own
-- `alter function ... security definer;` (200000:233, 250000:109), and
-- 250000 -- the last migration to touch this function -- also re-checks
-- prosecdef inline before registering its own release. A clean
-- `pnpm db:local` run against this branch, unmodified, passes all 50
-- registered assertions, `app.assert_process_square_refund_definer()`
-- included, and the readiness head matches the newest migration. (Quoted in
-- full in this change's PR description.) There is nothing to alter in the
-- live catalog today.
--
-- The one statement below is kept anyway as free insurance: idempotent
-- against the current state, and a correct fix the day a future migration
-- copies 200000's or 250000's CREATE OR REPLACE without also copying the
-- self-healing ALTER that follows it in both. No new assertion is added for
-- this: app.assert_process_square_refund_definer() already checks
-- prosecdef, the pinned search_path and the exact grant set, and -- unlike
-- a one-time migration check -- it is re-run against live catalog state on
-- every db:local and CI invocation, so it already catches that regression
-- the moment it lands. A second assertion of the identical predicate over
-- the identical function would add no coverage, only upkeep.
alter function public.process_square_refund(uuid, text, text, bigint, text)
  security definer;

-- The argument-identity-writer guard, generalized past its own hardcoded list.
--
-- 20260904000000 named eight public SECURITY DEFINER functions that
-- authorize by trusting a caller-supplied identity argument instead of
-- resolving auth.uid() themselves, and asserted none is executable by anon
-- or authenticated. 20260908228000_connector_credential_lifecycle.sql later
-- added five more of the same shape -- begin_connector_oauth_state,
-- consume_connector_oauth_state, complete_connector_oauth_connection,
-- disconnect_connector_oauth_connection and
-- queue_connector_oauth_compensation -- none of which that guard watches,
-- because it only knows the eight signatures spelled out in its array.
-- They are correctly service_role-only today (verified below); the guard
-- just cannot see them, or the next one shaped like them.
--
-- Naming rule, derived by reading all thirteen plus the wider schema: every
-- one of the eight originals takes the trusted identity as its FIRST
-- parameter, always named p_actor_id. The five connector functions take it
-- at a later position (2nd-4th of up to twelve parameters) and always name
-- it p_actor_user_id. Position is therefore not the invariant; the
-- parameter name is, at any position.
--
-- p_user_id -- also suggested as a candidate name -- is deliberately
-- excluded. public.manage_platform_brand_member's p_user_id is the member
-- being changed, not the caller (the caller is its own, first, p_actor_id).
-- public.export_customer_account_data(p_user_id) and
-- anonymize_customer_account(p_user_id) cross-check that argument against
-- auth.uid() rather than trusting it outright -- the same safe, self-service
-- shape public.create_platform_organization uses by resolving auth.uid()
-- directly. Matching p_user_id would not fail today (everything it would
-- additionally catch already happens to be service-role only), but it would
-- assert a rule these functions do not follow, for no present benefit.
create or replace function app.assert_argument_identity_writers_enumerated()
returns void language plpgsql stable security invoker set search_path = '' as $$
declare
  matched integer;
  offender text;
begin
  select count(*) into matched
  from pg_catalog.pg_proc proc
  join pg_catalog.pg_namespace ns on ns.oid = proc.pronamespace
  where ns.nspname = 'public'
    and proc.prosecdef
    and exists (
      select 1 from unnest(proc.proargnames) arg(name)
      where arg.name in ('p_actor_id', 'p_actor_user_id')
    );

  -- A count of zero would mean the naming rule stopped matching anything --
  -- the exact silent-empty-guard failure 20260904000000's own comment warned
  -- about. Anchor above the fourteen known today (the original eight, the
  -- five connector writers, and the tenant-package access logger) so a
  -- future rename that drops matches is loud rather than quietly green.
  if matched < 12 then
    raise exception
      'argument-identity writer enumeration found % (expected at least 12); '
      'the p_actor_id/p_actor_user_id naming rule may have stopped matching',
      matched;
  end if;

  for offender in
    select proc.oid::regprocedure::text
    from pg_catalog.pg_proc proc
    join pg_catalog.pg_namespace ns on ns.oid = proc.pronamespace
    where ns.nspname = 'public'
      and proc.prosecdef
      and exists (
        select 1 from unnest(proc.proargnames) arg(name)
        where arg.name in ('p_actor_id', 'p_actor_user_id')
      )
      and (
        pg_catalog.has_function_privilege('anon', proc.oid, 'EXECUTE')
        or pg_catalog.has_function_privilege('authenticated', proc.oid, 'EXECUTE')
      )
  loop
    raise exception
      'argument-identity writer % is reachable by anon or authenticated, '
      'which would choose its own trusted identity argument', offender;
  end loop;
end $$;

revoke all on function app.assert_argument_identity_writers_enumerated()
  from public, anon, authenticated;
grant execute on function app.assert_argument_identity_writers_enumerated()
  to service_role;

-- 20260904000000's assertion stays registered and keeps running: it is
-- still correct for the eight it names, and this migration adds coverage
-- rather than replacing history.
select app.register_release(
  '20260912040000',
  'argument-identity writers enumerated by parameter name instead of a '
  'hardcoded list, covering the five connector-lifecycle writers '
  '20260904000000 could not see; process_square_refund''s definer contract '
  're-verified and found already intact at head',
  'app.assert_argument_identity_writers_enumerated()'::regprocedure
);
