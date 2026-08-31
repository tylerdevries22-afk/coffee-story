-- Brand directory for platform operators, and an append-only audit of
-- cross-tenant access.
--
-- The organization switcher lets a platform_admin drill into any brand; these
-- give that reach a safe read and a durable record. brand_directory is the
-- operator's minimal cross-brand read -- identity, feature flags, and a live
-- location count -- deliberately without the commercial terms (fee_bps and the
-- volume tiering) that brand_storefront also withholds, so a franchise console
-- can list every tenant without ever selecting the platform's take from the
-- base table. platform_access_events is the immutable trail: who acted inside
-- which brand/location, when, correlated to one action, written only through a
-- service-role RPC so the record cannot be forged or edited.

-- A cross-brand read for platform operators only. security_barrier so the
-- is_platform_admin() predicate is evaluated before any exposed column is
-- computed, and the fee columns are simply never selected.
create or replace view public.brand_directory with (security_barrier) as
  select
    b.id,
    b.slug,
    b.name,
    b.drops, b.catering, b.delivery, b.multi_location,
    b.sms, b.stored_value, b.referrals,
    b.created_at,
    (select count(*) from public.locations l where l.brand_id = b.id) as location_count
  from public.brands b
  where app.is_platform_admin();

grant select on public.brand_directory to authenticated;
-- 0014 grants ALL on new views to authenticated by default, which would make
-- this view a write path into brands; close it as every other view does.
revoke insert, update, delete on public.brand_directory from anon, authenticated;

-- The immutable cross-tenant access trail.
create table public.platform_access_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users (id) on delete set null,
  brand_id uuid references public.brands (id) on delete set null,
  location_id uuid references public.locations (id) on delete set null,
  action text not null,
  correlation_id uuid not null,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object' and pg_column_size(metadata) <= 32768),
  created_at timestamptz not null default now()
);

create index platform_access_brand_created_idx
  on public.platform_access_events (brand_id, created_at desc);
create index platform_access_actor_idx
  on public.platform_access_events (actor_id);
create index platform_access_location_idx
  on public.platform_access_events (location_id);
create unique index platform_access_action_correlation_uidx
  on public.platform_access_events (action, correlation_id);

-- Append-only, while still allowing PostgreSQL's ON DELETE SET NULL RI
-- trigger to clear a nullable foreign key when an actor, brand, or location
-- is removed. A direct client update runs at trigger depth 1 and is rejected;
-- the nested RI update is accepted only when it changes one of those three
-- nullable references to NULL and nothing else.
create or replace function app.reject_platform_access_mutation() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if TG_OP = 'UPDATE'
     and pg_catalog.pg_trigger_depth() > 1
     and (NEW.actor_id is null or OLD.actor_id is not distinct from NEW.actor_id)
     and (NEW.brand_id is null or OLD.brand_id is not distinct from NEW.brand_id)
     and (NEW.location_id is null or OLD.location_id is not distinct from NEW.location_id)
     and OLD.action is not distinct from NEW.action
     and OLD.correlation_id is not distinct from NEW.correlation_id
     and OLD.metadata is not distinct from NEW.metadata
     and OLD.created_at is not distinct from NEW.created_at
  then
    return NEW;
  end if;
  raise exception using errcode = '55000', message = 'record_is_append_only';
end $$;
revoke all on function app.reject_platform_access_mutation() from public, anon, authenticated;

create trigger platform_access_immutable
before update or delete on public.platform_access_events
for each row execute function app.reject_platform_access_mutation();

alter table public.platform_access_events enable row level security;

-- Platform operators may read the trail; nobody writes it through a client.
create policy platform_access_select on public.platform_access_events
  for select to authenticated
  using (app.is_platform_admin());

revoke all on public.platform_access_events from public, anon, authenticated;
grant select on public.platform_access_events to authenticated;
grant all on public.platform_access_events to service_role;

-- The only writer: a service-role RPC, so the trail is written by trusted code
-- and is idempotent on (action, correlation_id) the way the factory audit is.
create or replace function public.record_platform_access(
  p_actor_id uuid,
  p_brand_id uuid,
  p_location_id uuid,
  p_action text,
  p_correlation_id uuid,
  p_metadata jsonb default '{}'::jsonb
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.platform_access_events (actor_id, brand_id, location_id, action, correlation_id, metadata)
  values (p_actor_id, p_brand_id, p_location_id, p_action, p_correlation_id, coalesce(p_metadata, '{}'::jsonb))
  on conflict (action, correlation_id) do nothing;
end $$;

revoke all on function public.record_platform_access(uuid, uuid, uuid, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.record_platform_access(uuid, uuid, uuid, text, uuid, jsonb) to service_role;

-- Serialize location capacity against the brand row. A UI preflight cannot
-- enforce the single-location plan because two first-store requests can both
-- observe a count of zero; this transaction makes the check and insert one
-- indivisible operation while still relying on the caller's RLS identity.
create or replace function public.create_location_if_allowed(
  target_brand_id uuid,
  location_name text,
  location_address jsonb,
  location_hours jsonb,
  location_timezone text
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  multi_location_enabled boolean;
  created_location_id uuid;
begin
  select brand.multi_location
    into multi_location_enabled
    from public.brands as brand
   where brand.id = target_brand_id
     and app.is_brand_owner(target_brand_id)
     for update;

  if not found then
    raise exception using errcode = '42501', message = 'location_access_denied';
  end if;
  if not multi_location_enabled and exists (
    select 1 from public.locations where brand_id = target_brand_id
  ) then
    raise exception using errcode = '23514', message = 'single_location_limit_reached';
  end if;

  insert into public.locations (brand_id, name, address, hours, timezone)
  values (target_brand_id, location_name, location_address, location_hours, location_timezone)
  returning id into created_location_id;
  return created_location_id;
end $$;

revoke all on function public.create_location_if_allowed(uuid, text, jsonb, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.create_location_if_allowed(uuid, text, jsonb, jsonb, text)
  to authenticated;

-- Extend the release-readiness chain so the deploy gate proves the database is
-- migrated up to this version and every prior link is intact.
alter function public.platform_release_readiness()
  rename to platform_release_readiness_20260830020000;
alter function public.platform_release_readiness_20260830020000() set schema app;
revoke all on function app.platform_release_readiness_20260830020000()
  from public, anon, authenticated;
grant execute on function app.platform_release_readiness_20260830020000()
  to service_role;

create or replace function public.platform_release_readiness()
returns text language plpgsql stable security invoker set search_path = '' as $$
begin
  if app.platform_release_readiness_20260830020000() <> '20260830020000' then
    raise exception 'brand directory readiness prerequisite is incomplete';
  end if;
  return '20260831000000';
end $$;
revoke all on function public.platform_release_readiness()
  from public, anon, authenticated;
grant execute on function public.platform_release_readiness()
  to service_role;
