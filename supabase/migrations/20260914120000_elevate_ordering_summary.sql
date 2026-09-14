-- A platform operator reading one brand's ordering summary from outside the
-- console -- specifically, the Elevate admin portal rendering an "Ordering"
-- tab for a tenant it already governs.
--
-- Two things had to be true at once. The read has to cross brands, because the
-- operator is not a member of the brand whose numbers it shows; and it must not
-- become a way for any platform admin to read every brand on the platform. So
-- the identity is resolved from auth.uid() rather than accepted as an argument
-- (the rule 20260903193000 established: "self-authorizing only while its caller
-- is trusted to name the subject honestly"), and the brand must have opted in.
--
-- The opt-in is the part worth the table. An enrollment row is a brand saying
-- "this integration may read my summary", and clearing revoked_at is an off
-- switch that takes effect on the next request with no token to expire. Without
-- it, a compromised operator account reads the whole platform; with it, it
-- reads exactly the brands that agreed.

create table public.integration_brand_enrollments (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  integration_key text not null
    check (integration_key ~ '^[a-z][a-z0-9_-]{0,62}$'),
  enrolled_by uuid references auth.users (id) on delete set null,
  enrolled_at timestamptz not null default now(),
  revoked_at timestamptz
);

-- app.assert_foreign_keys_are_indexed() (20260912080000) scans every public
-- foreign key, so a missing index here fails the whole readiness chain, not
-- just this migration.
create index integration_brand_enrollments_brand_idx
  on public.integration_brand_enrollments (brand_id);
create index integration_brand_enrollments_enrolled_by_idx
  on public.integration_brand_enrollments (enrolled_by);

-- One live enrollment per brand per integration. Re-enrolling after a
-- revocation is a new row, so the history of who turned it on and off survives.
create unique index integration_brand_enrollments_live_idx
  on public.integration_brand_enrollments (brand_id, integration_key)
  where revoked_at is null;

alter table public.integration_brand_enrollments enable row level security;

-- 0014 grants ALL on new public tables to authenticated, so RLS alone is not
-- the whole story: the write grant has to come back off explicitly. A policy
-- that refuses every write is belt and braces for the same reason
-- 20260911160000 gave -- RLS with no policy is only fail-closed while the
-- table is also ungranted.
create policy integration_brand_enrollments_select
  on public.integration_brand_enrollments for select to authenticated
  using (app.is_brand_staff(brand_id) or app.is_platform_admin());

create policy integration_brand_enrollments_deny_write
  on public.integration_brand_enrollments for all to authenticated, anon
  using (false) with check (false);

revoke insert, update, delete on public.integration_brand_enrollments
  from anon, authenticated;

comment on table public.integration_brand_enrollments is
  'Brands that opted a platform integration into reading their summary. Never an entitlement to write.';

-- The read itself. p_brand_id is the only thing a caller chooses, and it is
-- authorized rather than trusted: the caller must be a live platform admin AND
-- the named brand must hold a live enrollment.
--
-- Aggregates only -- counts, sums, booleans, a location name and timezone.
-- Never an order row, never a customer field, and never the brand's fee RATES
-- (fee_bps and friends are staff-only; tests/integration/src/tenancy-leaks.test.ts
-- exists to keep them that way). fee_cents totals are money already collected,
-- which is a different fact from the terms that produced it.
create or replace function public.caller_brand_ordering_summary(p_brand_id uuid)
returns table (
  brand_slug text,
  brand_name text,
  location_id uuid,
  location_name text,
  location_timezone text,
  ordering_paused boolean,
  local_day date,
  orders_today integer,
  revenue_cents_today bigint,
  fee_cents_today bigint,
  fee_cents_month_to_date bigint,
  square_connected boolean,
  square_needs_reconsent boolean,
  menu_published boolean,
  menu_id uuid,
  menu_updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller uuid;
begin
  -- Hoisted out of the predicate so it is evaluated once, per 20260902144208.
  caller := (select auth.uid());
  if caller is null or not app.is_platform_admin() then
    raise exception using errcode = 'P0002', message = 'ordering_summary_denied';
  end if;

  -- Deliberately the same error as the admin check above. Two distinguishable
  -- failures would make this endpoint an oracle for which brands exist.
  if not exists (
    select 1
    from public.integration_brand_enrollments enrollment
    where enrollment.brand_id = p_brand_id
      and enrollment.integration_key = 'elevate-ordering'
      and enrollment.revoked_at is null
  ) then
    raise exception using errcode = 'P0002', message = 'ordering_summary_denied';
  end if;

  return query
  select
    brand.slug,
    brand.name,
    location.id,
    location.name,
    location.timezone,
    location.ordering_paused,
    (pg_catalog.now() at time zone location.timezone)::date,
    (
      select pg_catalog.count(*)
      from public.orders o
      where o.location_id = location.id
        and o.status not in ('created', 'cancelled', 'refunded')
        and (o.created_at at time zone location.timezone)::date
            = (pg_catalog.now() at time zone location.timezone)::date
    )::integer,
    (
      select coalesce(pg_catalog.sum(o.total_cents), 0)
      from public.orders o
      where o.location_id = location.id
        and o.status not in ('created', 'cancelled', 'refunded')
        and (o.created_at at time zone location.timezone)::date
            = (pg_catalog.now() at time zone location.timezone)::date
    )::bigint,
    (
      select coalesce(pg_catalog.sum(fee.fee_cents), 0)
      from public.platform_fees fee
      where fee.location_id = location.id
        and (fee.created_at at time zone location.timezone)::date
            = (pg_catalog.now() at time zone location.timezone)::date
    )::bigint,
    (
      select coalesce(pg_catalog.sum(fee.fee_cents), 0)
      from public.platform_fees fee
      where fee.location_id = location.id
        and (fee.created_at at time zone location.timezone)
            >= pg_catalog.date_trunc(
                 'month', pg_catalog.now() at time zone location.timezone)
    )::bigint,
    (connection.id is not null),
    -- The OAuth scope contract is at version 2 (20260912 lifecycle work). A
    -- connection still on an older contract works until it does not, and the
    -- console renders Reconnect for it rather than Connected.
    (connection.id is not null
      and coalesce(connection.oauth_scope_contract_version, 0) < 2),
    (menu.id is not null),
    menu.id,
    menu.updated_at
  from public.locations location
  join public.brands brand on brand.id = location.brand_id
  left join public.square_connections connection
    on connection.location_id = location.id
  left join lateral (
    select published.id, published.updated_at
    from public.menus published
    where published.brand_id = location.brand_id
      and published.is_published
    order by published.updated_at desc nulls last
    limit 1
  ) as menu on true
  where location.brand_id = p_brand_id
  order by location.name;
end
$$;

revoke all on function public.caller_brand_ordering_summary(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.caller_brand_ordering_summary(uuid)
  to authenticated, service_role;

-- The assertion reads the shipped function body, so a later edit that drops a
-- gate fails platform_release_readiness() rather than shipping quietly.
create or replace function app.assert_elevate_ordering_summary()
returns void language plpgsql stable security invoker set search_path = '' as $$
declare
  body text;
  search_path_value text;
begin
  if pg_catalog.to_regprocedure('public.caller_brand_ordering_summary(uuid)') is null then
    raise exception 'the ordering summary read is missing';
  end if;

  body := pg_catalog.pg_get_functiondef(
    'public.caller_brand_ordering_summary(uuid)'::regprocedure);
  if body !~ 'app\.is_platform_admin' then
    raise exception 'the ordering summary no longer checks platform admin';
  end if;
  if body !~ 'integration_brand_enrollments' then
    raise exception 'the ordering summary no longer requires a live enrollment';
  end if;
  if body !~ 'auth\.uid' then
    raise exception 'the ordering summary no longer resolves its caller identity';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_proc proc
    where proc.oid = 'public.caller_brand_ordering_summary(uuid)'::regprocedure
      and proc.prosecdef
  ) then
    raise exception 'the ordering summary must be security definer to cross brands';
  end if;

  select pg_catalog.split_part(cfg, '=', 2) into search_path_value
  from pg_catalog.unnest(coalesce((
    select proc.proconfig from pg_catalog.pg_proc proc
    where proc.oid = 'public.caller_brand_ordering_summary(uuid)'::regprocedure
  ), '{}'::text[])) as cfg
  where cfg like 'search_path=%'
  limit 1;
  if coalesce(search_path_value, '(unset)') not in ('""', '') then
    raise exception 'the ordering summary is security definer without a pinned '
      'empty search_path: %', coalesce(search_path_value, '(unset)');
  end if;

  if has_function_privilege('anon', 'public.caller_brand_ordering_summary(uuid)', 'execute') then
    raise exception 'the ordering summary is reachable by anon';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_class cls
    where cls.oid = 'public.integration_brand_enrollments'::regclass
      and cls.relrowsecurity
  ) then
    raise exception 'integration_brand_enrollments lost row level security';
  end if;

  if has_table_privilege('authenticated', 'public.integration_brand_enrollments', 'insert')
    or has_table_privilege('anon', 'public.integration_brand_enrollments', 'insert') then
    raise exception 'a client role can write integration_brand_enrollments';
  end if;
end $$;

revoke all on function app.assert_elevate_ordering_summary()
  from public, anon, authenticated;
grant execute on function app.assert_elevate_ordering_summary() to service_role;

select app.register_release(
  '20260914120000',
  'a platform operator reads one brand''s ordering summary only while that brand holds a live integration enrollment; the caller is resolved from auth.uid(), never from an argument',
  'app.assert_elevate_ordering_summary()'::regprocedure
);
