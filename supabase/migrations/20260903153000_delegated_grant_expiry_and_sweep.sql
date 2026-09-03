-- A delegated grant stops being readable when it ends, and ended rows stop
-- accumulating.
--
-- delegated_access_grants_select has read
--   grantee_user_id = (select auth.uid()) or app.is_brand_owner(brand_id)
-- since 20260902144208, with no revoked_at or expires_at predicate. The KPI
-- data itself was never exposed by that: app.network_brand_kpis checks both
-- `revoked_at is null` and `expires_at > now()` before it returns a single
-- aggregate, and it is the only path to the numbers. What leaked is the grant
-- row -- brand_id, network_id, scope[], created_by, expires_at -- which a
-- revoked or long-expired grantee could still select. That is metadata about
-- who lent what to whom, not the lent data, and it is still a leak: revocation
-- is supposed to end the relationship, and a former delegate should not keep a
-- live view of a network's brand ids and the scopes someone once granted.
--
-- The grantee branch gains both predicates. The brand-owner branch keeps the
-- whole history on purpose: the brand issued the grant, and hiding a grant from
-- the brand that revoked it would delete the audit trail exactly where it is
-- wanted. `(select auth.uid())` stays wrapped -- 20260902144208 exists to
-- satisfy the auth_rls_initplan advisor, and the hosted gate fails on warn.
--
-- The sweeper is the other half. Nothing has ever written revoked_at and
-- nothing deletes a row once expires_at passes, so the table's 30-day CHECK
-- bounds how long a grant may *authorize* and says nothing about how long the
-- row lives. public.prune_delegated_access_grants stamps revoked_at on grants
-- that have simply run out -- the shape the table comment anticipated when it
-- said "the grantee (or an expiry sweep) can end it early via revoked_at" --
-- and then deletes rows that ended before the caller's cutoff. The cutoff is an
-- argument so retention can move without replacing the function, and the guard
-- refuses a cutoff inside the last 30 days so a mistyped call cannot delete
-- live history.
--
-- No index is added. The predicates ride the existing
-- delegated_access_grants_grantee_expiry_idx, which leads on the selective
-- column, and the sweep's scan is over a table holding one row per delegation
-- with a 30-day life -- adding an index for it would cost every write to buy a
-- sequential scan of tens of rows.
--
-- Cost: no table is rewritten and no data is backfilled. The policy swap takes
-- a brief ACCESS EXCLUSIVE lock on public.delegated_access_grants for the
-- catalog update only -- milliseconds, on a table currently holding tens of
-- rows at most.

drop policy delegated_access_grants_select on public.delegated_access_grants;
create policy delegated_access_grants_select on public.delegated_access_grants
  for select to authenticated
  using (
    (
      grantee_user_id = (select auth.uid())
      and revoked_at is null
      and expires_at > now()
    )
    or app.is_brand_owner(brand_id)
  );

-- The hosted scheduler calls this service-only helper, alongside the analytics
-- and operations retention passes it already runs.
create or replace function public.prune_delegated_access_grants(ended_before timestamptz)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  expired_count bigint;
  deleted_count bigint;
begin
  if ended_before > pg_catalog.now() - interval '30 days' then
    raise exception using errcode = '22023', message = 'delegated_grant_retention_cutoff_too_recent';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('delegated-access-grant-sweep', 0));

  -- revoked_at is set to the moment the grant actually stopped authorizing,
  -- not to now(): a tick that runs late must not backdate or postdate the end
  -- of a grant, and the retention window below is measured from it.
  update public.delegated_access_grants
     set revoked_at = expires_at
   where revoked_at is null
     and expires_at <= pg_catalog.now();
  get diagnostics expired_count = row_count;

  delete from public.delegated_access_grants
   where revoked_at is not null
     and revoked_at < ended_before;
  get diagnostics deleted_count = row_count;

  return pg_catalog.jsonb_build_object('expired', expired_count, 'deleted', deleted_count);
end $$;

revoke all on function public.prune_delegated_access_grants(timestamptz)
  from public, anon, authenticated;
grant execute on function public.prune_delegated_access_grants(timestamptz) to service_role;

-- Readiness: one assertion, registered rather than chained. 20260903020255
-- froze the nested rename chain, so a new claim on the release contract is a
-- row in app.release_assertions and a function the head can call.
create or replace function app.assert_delegated_grant_expiry()
returns void language plpgsql stable security invoker set search_path = '' as $$
begin
  if not exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'delegated_access_grants'
      and policyname = 'delegated_access_grants_select'
      and qual ~* 'revoked_at is null'
      and qual ~* 'expires_at >'
  ) then raise exception 'delegated grant policy lost its revocation or expiry predicate'; end if;
  -- The same balanced pattern 20260902155711 settled on: the advisor fix and
  -- this one must not undo each other.
  if not exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'delegated_access_grants'
      and policyname = 'delegated_access_grants_select'
      and qual ~* '\(\s*select\s+auth\.uid\(\)'
  ) then raise exception 'delegated grant policy lost its init-plan hoist'; end if;
  if pg_catalog.to_regprocedure('public.prune_delegated_access_grants(timestamptz)') is null then
    raise exception 'the delegated grant sweeper is missing';
  end if;
end $$;
revoke all on function app.assert_delegated_grant_expiry()
  from public, anon, authenticated;
grant execute on function app.assert_delegated_grant_expiry() to service_role;

select app.register_release(
  '20260903153000',
  'delegated grants stop being readable once revoked or expired, and a sweeper bounds row lifetime',
  'app.assert_delegated_grant_expiry()'::regprocedure
);
