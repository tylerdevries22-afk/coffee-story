-- Franchisors read their own network's KPIs, under their own session.
--
-- app.network_brand_kpis has answered this question correctly since
-- 20260902083817 and has never had a caller. It is granted to service_role
-- alone, so the only way to a network aggregate today is a process holding the
-- service key -- which is the exact bypass the aggregate exists to avoid.
-- "Franchisors get reporting without breaching tenant RLS" is not delivered by
-- a key that breaches all of it.
--
-- The obvious fix -- widen that grant to authenticated -- is wrong, and this
-- migration deliberately does not do it. app.network_brand_kpis takes the user
-- it authorizes as its second ARGUMENT, and it is security definer. Every
-- check in its body is against p_user_id; nothing anywhere compares p_user_id
-- to the session making the call. A client that could execute it would choose
-- whose network it was asking about, and
-- `select * from app.network_brand_kpis(<any network>, <that network's
-- franchisor>)` would pass all of them. The function is self-authorizing only
-- while its caller is trusted to name the subject honestly. That is true of
-- the engine and of nothing else, so widening the grant would convert a
-- correct function into network-wide impersonation.
--
-- The identity therefore stops being an argument.
-- public.caller_network_brand_kpis takes the network alone and resolves the
-- subject with auth.uid(), which a client cannot forge: it reads the verified
-- JWT the session presented, and it still returns the real end user inside a
-- definer body because SECURITY DEFINER changes the role, not the request
-- GUCs. Same membership check, same grant check, same columns, same numbers --
-- the caller has simply lost the ability to lie about who it is. The
-- two-argument form keeps its service-role-only grant, and
-- app.assert_franchisor_network_reporting makes that a release-gated invariant
-- rather than a habit somebody could undo.
--
-- It lands in `public` rather than `app` because that is the only place a
-- browser session can reach it: config.toml exposes `public` and `storage` to
-- PostgREST and nothing else, which is why every other client-callable routine
-- here -- mark_order_arrived, claim_operation_occurrence,
-- brand_storefront_lookup -- lives there too. `app` stays what it has been,
-- the schema for helpers only the database and the engine call.
--
-- The KPI still reads public.orders, and still means what it meant. Answering
-- it from public.analytics_daily_rollups was considered and rejected: those
-- rollups are built by app.rebuild_analytics_rollups from
-- public.analytics_events, and that builder inserts counts, actors, outcomes
-- and durations only -- it never writes total_value, which sits at its default
-- 0 on every row. Nor is an order an analytics event: nothing under apps/ or
-- packages/ emits one when an order is placed. Sourcing orders_30d and
-- gross_cents_30d from the rollups would not be a cheaper version of this KPI,
-- it would be a different KPI that returns zero. The window stays on orders,
-- where the money is, and gross stays gross -- cancelled and refunded orders
-- are counted here exactly as the service-role form counts them, because a
-- reporting surface and its own engine must not disagree about a number.
--
-- No index is added. The per-brand EXISTS was the reason one was proposed, and
-- the delegate branch is now a single semi-join instead -- planned and hashed
-- once per call rather than re-probed once per enrolled brand. What is left
-- rides delegated_access_grants_grantee_expiry_idx, whose leading column
-- already narrows to the handful of grants one user can hold under the table's
-- 30-day life. A composite over (grantee_user_id, network_id, brand_id) would
-- charge every write to buy a scan of tens of rows, which is the same trade
-- 20260903153000 declined for the same table.
--
-- Cost: creates two functions and inserts one row into app.release_assertions.
-- No table is read, rewritten or backfilled and no lock is taken on any public
-- table; the catalog writes are milliseconds against a registry currently
-- holding a handful of rows.

-- The reporting entry point for a human session. p_network_id is the only
-- thing a caller gets to choose.
create or replace function public.caller_network_brand_kpis(p_network_id uuid)
returns table (brand_id uuid, brand_name text, orders_30d integer, gross_cents_30d bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller uuid;
  is_member boolean;
begin
  -- Hoisted the way the policies hoist it. 20260902144208 exists to satisfy
  -- the auth_rls_initplan advisor and `pnpm supabase:verify` fails on warn, so
  -- the wrapped form is the house style even where a plpgsql assignment would
  -- evaluate it once regardless.
  caller := (select auth.uid());
  -- The service role reaches this with no JWT and therefore no subject. It has
  -- the two-argument form for that; there is no honest answer to "my network"
  -- for a session that is nobody.
  if caller is null then
    raise exception using errcode = 'P0002', message = 'network_access_denied';
  end if;

  is_member := exists (
    select 1 from public.franchise_memberships membership
    where membership.network_id = p_network_id
      and membership.user_id = caller
  );

  if not is_member and not exists (
    select 1
    from public.delegated_access_grants grant_row
    join public.franchise_network_brands member_brand
      on member_brand.network_id = p_network_id
     and member_brand.brand_id = grant_row.brand_id
    where grant_row.network_id = p_network_id
      and grant_row.grantee_user_id = caller
      and grant_row.revoked_at is null
      and grant_row.expires_at > pg_catalog.now()
      and 'network:kpis' = any (grant_row.scope)
  ) then
    raise exception using errcode = 'P0002', message = 'network_access_denied';
  end if;

  -- A member sees every enrolled brand; a delegate sees only the brands a live
  -- 'network:kpis' grant names. Either way the answer is counts and sums --
  -- never a raw order or customer field.
  --
  -- The name rides along because the caller cannot look it up: brand_directory
  -- is platform_admin only and a franchisor is not staff of the brands it
  -- reports on, so without this the console could render nothing but uuids. It
  -- discloses nothing new -- brand_storefront_lookup already hands brand.name
  -- to an anonymous caller who names the slug -- and it is identity, not the
  -- tenant data the aggregate exists to keep behind RLS.
  return query
  select member_brand.brand_id,
    brand.name,
    count(order_row.id)::integer as orders_30d,
    coalesce(sum(order_row.total_cents), 0)::bigint as gross_cents_30d
  from public.franchise_network_brands member_brand
  join public.brands brand on brand.id = member_brand.brand_id
  left join public.orders order_row
    on order_row.brand_id = member_brand.brand_id
   and order_row.created_at >= pg_catalog.now() - interval '30 days'
  where member_brand.network_id = p_network_id
    and (
      is_member
      or member_brand.brand_id in (
        select grant_row.brand_id
        from public.delegated_access_grants grant_row
        where grant_row.network_id = p_network_id
          and grant_row.grantee_user_id = caller
          and grant_row.revoked_at is null
          and grant_row.expires_at > pg_catalog.now()
          and 'network:kpis' = any (grant_row.scope)
      )
    )
  group by member_brand.brand_id, brand.name;
end $$;

revoke all on function public.caller_network_brand_kpis(uuid)
  from public, anon, authenticated;
grant execute on function public.caller_network_brand_kpis(uuid) to authenticated;
grant execute on function public.caller_network_brand_kpis(uuid) to service_role;

comment on function public.caller_network_brand_kpis(uuid) is
  'Network brand aggregates for the calling user. Resolves the subject from '
  'auth.uid() so a client cannot ask on another user''s behalf; the two-'
  'argument app.network_brand_kpis takes the subject as input and stays '
  'service-role only for that reason.';

create or replace function app.assert_franchisor_network_reporting()
returns void language plpgsql stable security invoker set search_path = '' as $$
begin
  if pg_catalog.to_regprocedure('public.caller_network_brand_kpis(uuid)') is null then
    raise exception 'the caller-identity network KPI function is missing';
  end if;
  if not pg_catalog.has_function_privilege(
       'authenticated', 'public.caller_network_brand_kpis(uuid)', 'execute') then
    raise exception 'franchisors cannot reach network KPIs under their own session';
  end if;
  -- The invariant this migration turns on. A form that takes the subject as an
  -- argument must never be reachable by a session that gets to choose the
  -- argument, so both client roles are checked rather than only the one a
  -- mistaken grant would most likely name.
  if pg_catalog.has_function_privilege(
       'authenticated', 'app.network_brand_kpis(uuid,uuid)', 'execute')
     or pg_catalog.has_function_privilege(
       'anon', 'app.network_brand_kpis(uuid,uuid)', 'execute') then
    raise exception 'the argument-identity network KPI function is reachable by a client role';
  end if;
end $$;
revoke all on function app.assert_franchisor_network_reporting()
  from public, anon, authenticated;
grant execute on function app.assert_franchisor_network_reporting() to service_role;

select app.register_release(
  '20260903193000',
  'franchisors read network KPIs under their own session; the argument-identity form stays service-role only',
  'app.assert_franchisor_network_reporting()'::regprocedure
);
