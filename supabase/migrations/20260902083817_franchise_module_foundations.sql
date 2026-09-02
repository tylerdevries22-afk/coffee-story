-- Phase 1b: franchise module foundations.
--
-- The modular franchise plan needs its cross-tenant surfaces before any
-- module ships: franchise networks and their memberships, the brands enrolled
-- in each network, per-brand module installations with an append-only event
-- trail, per-site config overrides, and time-boxed delegated access grants.
-- Two guarded writers hold the invariants no application bug may weaken:
-- app.set_module_installation_state is the only path that may move an
-- installation through its lifecycle (optimistic concurrency on
-- config_revision), and app.network_brand_kpis answers network aggregates
-- without ever returning raw tenant rows.
--
-- Ordering: this branch is stacked on feat/production-device-wall, whose
-- migration 20260902021857 (PR #68) lands first and carries the previous
-- readiness link; the chain extension at the bottom of this file asserts it.
-- Everything else referenced here (app.touch_updated_at, app.is_brand_staff,
-- the locations (id, brand_id) key) exists on main.

-- A network is a cross-tenant construct: no brand_id, no tenant RLS. Members
-- read it through their franchise_memberships rows; writes stay service-side.
create table public.franchise_networks (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z][a-z0-9-]{1,48}[a-z0-9]$'),
  name text not null check (length(btrim(name)) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger franchise_networks_touch before update on public.franchise_networks
  for each row execute function app.touch_updated_at();

create table public.franchise_memberships (
  network_id uuid not null references public.franchise_networks (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('franchisor_admin', 'franchisor_analyst')),
  created_at timestamptz not null default now(),
  primary key (network_id, user_id)
);

create table public.franchise_network_brands (
  network_id uuid not null references public.franchise_networks (id) on delete cascade,
  brand_id uuid not null references public.brands (id) on delete cascade,
  added_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (network_id, brand_id)
);

-- One row per (brand, module): the current config plus its revision. Every
-- state move goes through app.set_module_installation_state, which serializes
-- on the row lock and appends to module_installation_events.
create table public.module_installations (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  module_key text not null check (module_key ~ '^[a-z][a-z0-9-]{1,48}[a-z0-9]$'),
  version text not null check (version ~ '^\d+\.\d+\.\d+$'),
  state text not null default 'draft'
    check (state in ('draft', 'validating', 'active', 'suspended', 'disabled', 'error')),
  config jsonb not null default '{}'::jsonb
    check (jsonb_typeof(config) = 'object' and octet_length(config::text) <= 16384),
  config_revision integer not null default 1 check (config_revision >= 1),
  config_schema_version integer not null default 1 check (config_schema_version >= 1),
  installed_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (brand_id, module_key)
);

create trigger module_installations_touch before update on public.module_installations
  for each row execute function app.touch_updated_at();

create table public.module_installation_events (
  id bigint generated always as identity primary key,
  installation_id uuid not null references public.module_installations (id) on delete cascade,
  brand_id uuid not null,
  event text not null check (event ~ '^[a-z0-9_.]{1,60}$'),
  from_state text check (from_state is null or from_state in
    ('draft', 'validating', 'active', 'suspended', 'disabled', 'error')),
  to_state text check (to_state is null or to_state in
    ('draft', 'validating', 'active', 'suspended', 'disabled', 'error')),
  config_revision integer,
  actor uuid references auth.users (id) on delete restrict,
  detail jsonb check (detail is null or
    (jsonb_typeof(detail) = 'object' and octet_length(detail::text) <= 8192)),
  created_at timestamptz not null default now()
);

-- Append-only. A direct client write runs at trigger depth 1 and is rejected;
-- the referential cascade from a deleted installation or brand runs nested
-- and may clean history up. Same reasoning as app.reject_platform_access_mutation,
-- whose actor/brand/location keys needed an exception this table's keys do not.
create or replace function app.reject_module_installation_event_mutation() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if pg_catalog.pg_trigger_depth() > 1 then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  raise exception using errcode = '55000', message = 'module_installation_event_append_only';
end $$;

revoke all on function app.reject_module_installation_event_mutation()
  from public, anon, authenticated;

create trigger module_installation_events_append_only before update or delete
  on public.module_installation_events
  for each row execute function app.reject_module_installation_event_mutation();

-- Per-site config deltas. Both foreign keys are composite on purpose: the
-- brand agreement has to hold for every writer, not just the ones a policy
-- happens to cover (see 20260829190000).
create table public.site_module_overrides (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null,
  location_id uuid not null,
  module_key text not null check (module_key ~ '^[a-z][a-z0-9-]{1,48}[a-z0-9]$'),
  overrides jsonb not null default '{}'::jsonb
    check (jsonb_typeof(overrides) = 'object' and octet_length(overrides::text) <= 8192),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (brand_id, location_id, module_key),
  foreign key (location_id, brand_id) references public.locations (id, brand_id) on delete cascade,
  foreign key (brand_id, module_key) references public.module_installations (brand_id, module_key) on delete cascade
);

create trigger site_module_overrides_touch before update on public.site_module_overrides
  for each row execute function app.touch_updated_at();

-- Scope entries look like 'network:kpis'. CHECK expressions cannot carry a
-- subquery, so the per-entry pattern lives in an immutable helper, exactly
-- like app.valid_slug_set. Left world-executable for the same reason: a CHECK
-- runs with the inserting role's privileges.
create or replace function app.valid_delegated_scope(p_values text[])
returns boolean
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select coalesce(bool_and(
      entry.scope ~ '^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$'
    ), true)
    from unnest(p_values) as entry(scope)
$$;

-- A brand lends one scoped capability to one user for at most 30 days. The
-- grantee (or an expiry sweep) can end it early via revoked_at; created_by is
-- restricted so the audit attribution outlives any account cleanup.
create table public.delegated_access_grants (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  network_id uuid not null references public.franchise_networks (id) on delete cascade,
  grantee_user_id uuid not null references auth.users (id) on delete cascade,
  scope text[] not null
    check (cardinality(scope) <= 32 and app.valid_delegated_scope(scope)),
  created_by uuid references auth.users (id) on delete restrict,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at <= created_at + interval '30 days')
);

create index delegated_access_grants_grantee_expiry_idx
  on public.delegated_access_grants (grantee_user_id, expires_at);

-- Network membership lives in this table, not in JWT claims, so the franchise
-- policies need a definer-side read of it. These helpers answer one boolean
-- about one (network, user) pair; security definer breaks the RLS
-- self-reference a plain policy subquery on franchise_memberships would
-- recurse into. Like the claim helpers they stay world-executable, because a
-- policy expression runs with the querying role's function privileges.
create or replace function app.is_franchise_network_member(p_network_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.franchise_memberships membership
    where membership.network_id = p_network_id
      and membership.user_id = p_user_id
  )
$$;

create or replace function app.is_franchise_network_admin(p_network_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.franchise_memberships membership
    where membership.network_id = p_network_id
      and membership.user_id = p_user_id
      and membership.role = 'franchisor_admin'
  )
$$;

-- RLS ---------------------------------------------------------------------

alter table public.franchise_networks enable row level security;
alter table public.franchise_memberships enable row level security;
alter table public.franchise_network_brands enable row level security;
alter table public.module_installations enable row level security;
alter table public.module_installation_events enable row level security;
alter table public.site_module_overrides enable row level security;
alter table public.delegated_access_grants enable row level security;

-- Everything below is read-only for clients. Writes go through the engine's
-- service role and the guarded writers, never through a direct client call.
create policy franchise_networks_select on public.franchise_networks
  for select to authenticated
  using (app.is_franchise_network_member(id, auth.uid()));

create policy franchise_memberships_select on public.franchise_memberships
  for select to authenticated
  using (user_id = auth.uid() or app.is_franchise_network_admin(network_id, auth.uid()));

create policy franchise_network_brands_select on public.franchise_network_brands
  for select to authenticated
  using (app.is_franchise_network_member(network_id, auth.uid()));

create policy module_installations_select on public.module_installations
  for select to authenticated
  using (app.is_brand_staff(brand_id));

create policy module_installation_events_select on public.module_installation_events
  for select to authenticated
  using (app.is_brand_staff(brand_id));

create policy site_module_overrides_select on public.site_module_overrides
  for select to authenticated
  using (app.is_brand_staff(brand_id));

create policy delegated_access_grants_select on public.delegated_access_grants
  for select to authenticated
  using (grantee_user_id = auth.uid() or app.is_brand_owner(brand_id));

revoke all on public.franchise_networks from public, anon, authenticated;
grant select on public.franchise_networks to authenticated;
grant all on public.franchise_networks to service_role;

revoke all on public.franchise_memberships from public, anon, authenticated;
grant select on public.franchise_memberships to authenticated;
grant all on public.franchise_memberships to service_role;

revoke all on public.franchise_network_brands from public, anon, authenticated;
grant select on public.franchise_network_brands to authenticated;
grant all on public.franchise_network_brands to service_role;

revoke all on public.module_installations from public, anon, authenticated;
grant select on public.module_installations to authenticated;
grant all on public.module_installations to service_role;

revoke all on public.module_installation_events from public, anon, authenticated;
grant select on public.module_installation_events to authenticated;
grant all on public.module_installation_events to service_role;

revoke all on public.site_module_overrides from public, anon, authenticated;
grant select on public.site_module_overrides to authenticated;
grant all on public.site_module_overrides to service_role;

revoke all on public.delegated_access_grants from public, anon, authenticated;
grant select on public.delegated_access_grants to authenticated;
grant all on public.delegated_access_grants to service_role;

-- Guarded writers ----------------------------------------------------------

-- The only path that may move an installation through its lifecycle:
-- draft -> validating -> active -> suspended -> disabled | error, with
-- validating -> error for a failed validation, disabled reachable from any
-- state, error -> validating for a retry, and disabled -> draft for a
-- reinstall. The brand id is taken alongside the installation id so a caller
-- cannot name another tenant's row. A null p_config keeps the current config;
-- the transition and its event row commit or roll back together.
create or replace function app.set_module_installation_state(
  p_installation_id uuid,
  p_brand_id uuid,
  p_to_state text,
  p_config jsonb,
  p_expected_revision integer,
  p_actor uuid,
  p_correlation_id uuid
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  installation public.module_installations%rowtype;
  next_revision integer;
begin
  select * into installation
  from public.module_installations target
  where target.id = p_installation_id and target.brand_id = p_brand_id
  for update;
  if not found then
    raise exception using errcode = '23503', message = 'module_installation_not_found';
  end if;
  if not (
    (installation.state = 'draft' and p_to_state = 'validating')
    or (installation.state = 'validating' and p_to_state in ('active', 'error'))
    or (installation.state = 'active' and p_to_state = 'suspended')
    or (installation.state = 'suspended' and p_to_state = 'error')
    or (installation.state = 'error' and p_to_state = 'validating')
    or (installation.state = 'disabled' and p_to_state = 'draft')
    or p_to_state = 'disabled'
  ) then
    raise exception using errcode = '22023', message = 'invalid_module_state_transition';
  end if;
  if installation.config_revision is distinct from p_expected_revision then
    raise exception using errcode = '40001', message = 'module_installation_revision_conflict';
  end if;
  if p_config is not null
     and (jsonb_typeof(p_config) is distinct from 'object'
          or octet_length(p_config::text) > 16384) then
    raise exception using errcode = '22023', message = 'invalid_module_config';
  end if;

  next_revision := installation.config_revision + 1;
  update public.module_installations target set
    state = p_to_state,
    config = coalesce(p_config, target.config),
    config_revision = next_revision
  where target.id = installation.id;

  insert into public.module_installation_events (
    installation_id, brand_id, event, from_state, to_state,
    config_revision, actor, detail
  ) values (
    installation.id, installation.brand_id, 'state.transition',
    installation.state, p_to_state, next_revision, p_actor,
    jsonb_build_object('correlation_id', p_correlation_id)
  );
  return next_revision;
end $$;

revoke all on function app.set_module_installation_state(uuid, uuid, text, jsonb, integer, uuid, uuid)
  from public, anon, authenticated;
grant execute on function app.set_module_installation_state(uuid, uuid, text, jsonb, integer, uuid, uuid)
  to service_role;

-- Network-level aggregates for franchisors and time-boxed delegates. A member
-- sees every enrolled brand; a delegate sees only the brands a live
-- 'network:kpis' grant names. Either way the answer is counts and sums --
-- never a raw order or customer field.
create or replace function app.network_brand_kpis(
  p_network_id uuid,
  p_user_id uuid
) returns table (brand_id uuid, orders_30d integer, gross_cents_30d bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.franchise_memberships membership
    where membership.network_id = p_network_id
      and membership.user_id = p_user_id
  ) and not exists (
    select 1
    from public.delegated_access_grants grant_row
    join public.franchise_network_brands member_brand
      on member_brand.network_id = p_network_id
     and member_brand.brand_id = grant_row.brand_id
    where grant_row.network_id = p_network_id
      and grant_row.grantee_user_id = p_user_id
      and grant_row.revoked_at is null
      and grant_row.expires_at > pg_catalog.now()
      and 'network:kpis' = any (grant_row.scope)
  ) then
    raise exception using errcode = 'P0002', message = 'network_access_denied';
  end if;

  return query
  select member_brand.brand_id,
    count(order_row.id)::integer as orders_30d,
    coalesce(sum(order_row.total_cents), 0)::bigint as gross_cents_30d
  from public.franchise_network_brands member_brand
  left join public.orders order_row
    on order_row.brand_id = member_brand.brand_id
   and order_row.created_at >= pg_catalog.now() - interval '30 days'
  where member_brand.network_id = p_network_id
    and (
      exists (
        select 1 from public.franchise_memberships membership
        where membership.network_id = p_network_id
          and membership.user_id = p_user_id
      ) or exists (
        select 1 from public.delegated_access_grants grant_row
        where grant_row.network_id = p_network_id
          and grant_row.brand_id = member_brand.brand_id
          and grant_row.grantee_user_id = p_user_id
          and grant_row.revoked_at is null
          and grant_row.expires_at > pg_catalog.now()
          and 'network:kpis' = any (grant_row.scope)
      )
    )
  group by member_brand.brand_id;
end $$;

revoke all on function app.network_brand_kpis(uuid, uuid)
  from public, anon, authenticated;
grant execute on function app.network_brand_kpis(uuid, uuid)
  to service_role;

-- This branch is stacked on feat/production-device-wall (PR #68 lands first),
-- so the readiness chain extends from its link, 20260902021857. Keep hosted
-- deploys fail-closed until the new tables and their RLS are installed.
alter function public.platform_release_readiness()
  rename to platform_release_readiness_20260902021857;
alter function public.platform_release_readiness_20260902021857() set schema app;
revoke all on function app.platform_release_readiness_20260902021857()
  from public, anon, authenticated;
grant execute on function app.platform_release_readiness_20260902021857()
  to service_role;

create or replace function public.platform_release_readiness()
returns text language plpgsql stable security invoker set search_path = '' as $$
begin
  if app.platform_release_readiness_20260902021857() <> '20260902021857' then
    raise exception 'franchise module readiness prerequisite is incomplete';
  end if;
  if pg_catalog.to_regclass('public.franchise_networks') is null
     or pg_catalog.to_regclass('public.franchise_memberships') is null
     or pg_catalog.to_regclass('public.franchise_network_brands') is null
     or pg_catalog.to_regclass('public.module_installations') is null
     or pg_catalog.to_regclass('public.module_installation_events') is null
     or pg_catalog.to_regclass('public.site_module_overrides') is null
     or pg_catalog.to_regclass('public.delegated_access_grants') is null then
    raise exception 'franchise module foundations tables are missing';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_class
    where oid = 'public.module_installations'::regclass and relrowsecurity
  ) or not exists (
    select 1 from pg_catalog.pg_class
    where oid = 'public.delegated_access_grants'::regclass and relrowsecurity
  ) then raise exception 'franchise module foundations are not protected by RLS'; end if;
  return '20260902083817';
end $$;

revoke all on function public.platform_release_readiness()
  from public, anon, authenticated;
grant execute on function public.platform_release_readiness()
  to service_role;
