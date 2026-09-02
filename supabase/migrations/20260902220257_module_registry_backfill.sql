-- Phase 2: backfill module_installations from the legacy brand flag columns.
--
-- Until the module cutover completes, the boolean flags on public.brands
-- (20260722000002: drops, catering, delivery, stored_value, referrals;
-- 20260828000000: operations) are the runtime source of truth for what a
-- tenant may do. This forward-only migration gives every brand whose flag is
-- set an active installation of the module that replaces the flag, at
-- version 1.0.0, so the new entitlement surface agrees with the legacy flags
-- before dual-read begins. multi_location and sms are deliberately not
-- backfilled: they are capacity/integration settings, not capability
-- modules.
--
-- Each insert keys on the unique (brand_id, module_key) constraint with ON
-- CONFLICT DO NOTHING, so a re-run inserts nothing and the event trail never
-- repeats. Backfilled rows land directly in 'active' -- the legacy flags
-- have no lifecycle, and an inactive backfill would silently strip
-- capabilities a brand already has. The audit event is 'backfilled', which
-- satisfies module_installation_events' check (event ~ '^[a-z0-9_.]{1,60}$');
-- installed_by and actor stay null because no user performed this.

with backfilled as (
  insert into public.module_installations (brand_id, module_key, version, state)
  select brand.id, 'growth-stored-value', '1.0.0', 'active'
  from public.brands brand
  where brand.stored_value is true
  on conflict (brand_id, module_key) do nothing
  returning id, brand_id
)
insert into public.module_installation_events (
  installation_id, brand_id, event, from_state, to_state, config_revision, detail
)
select backfilled.id, backfilled.brand_id, 'backfilled', null, 'active', 1,
  jsonb_build_object('source', 'legacy_flag', 'flag', 'stored_value')
from backfilled;

with backfilled as (
  insert into public.module_installations (brand_id, module_key, version, state)
  select brand.id, 'growth-referrals', '1.0.0', 'active'
  from public.brands brand
  where brand.referrals is true
  on conflict (brand_id, module_key) do nothing
  returning id, brand_id
)
insert into public.module_installation_events (
  installation_id, brand_id, event, from_state, to_state, config_revision, detail
)
select backfilled.id, backfilled.brand_id, 'backfilled', null, 'active', 1,
  jsonb_build_object('source', 'legacy_flag', 'flag', 'referrals')
from backfilled;

with backfilled as (
  insert into public.module_installations (brand_id, module_key, version, state)
  select brand.id, 'growth-drops', '1.0.0', 'active'
  from public.brands brand
  where brand.drops is true
  on conflict (brand_id, module_key) do nothing
  returning id, brand_id
)
insert into public.module_installation_events (
  installation_id, brand_id, event, from_state, to_state, config_revision, detail
)
select backfilled.id, backfilled.brand_id, 'backfilled', null, 'active', 1,
  jsonb_build_object('source', 'legacy_flag', 'flag', 'drops')
from backfilled;

with backfilled as (
  insert into public.module_installations (brand_id, module_key, version, state)
  select brand.id, 'commerce-catering', '1.0.0', 'active'
  from public.brands brand
  where brand.catering is true
  on conflict (brand_id, module_key) do nothing
  returning id, brand_id
)
insert into public.module_installation_events (
  installation_id, brand_id, event, from_state, to_state, config_revision, detail
)
select backfilled.id, backfilled.brand_id, 'backfilled', null, 'active', 1,
  jsonb_build_object('source', 'legacy_flag', 'flag', 'catering')
from backfilled;

with backfilled as (
  insert into public.module_installations (brand_id, module_key, version, state)
  select brand.id, 'commerce-delivery', '1.0.0', 'active'
  from public.brands brand
  where brand.delivery is true
  on conflict (brand_id, module_key) do nothing
  returning id, brand_id
)
insert into public.module_installation_events (
  installation_id, brand_id, event, from_state, to_state, config_revision, detail
)
select backfilled.id, backfilled.brand_id, 'backfilled', null, 'active', 1,
  jsonb_build_object('source', 'legacy_flag', 'flag', 'delivery')
from backfilled;

with backfilled as (
  insert into public.module_installations (brand_id, module_key, version, state)
  select brand.id, 'workforce-operations', '1.0.0', 'active'
  from public.brands brand
  where brand.operations is true
  on conflict (brand_id, module_key) do nothing
  returning id, brand_id
)
insert into public.module_installation_events (
  installation_id, brand_id, event, from_state, to_state, config_revision, detail
)
select backfilled.id, backfilled.brand_id, 'backfilled', null, 'active', 1,
  jsonb_build_object('source', 'legacy_flag', 'flag', 'operations')
from backfilled;

-- Readiness chain extension. The assertions below are stated against the data
-- itself -- a flag still set with no active installation of its replacement
-- module means the backfill did not run or was rolled back partially, and the
-- release must fail closed. Once the plan's legacy-flag removal lands, the
-- migration that drops these columns must replace this link's assertions at
-- the same time, because archived links keep being evaluated by the head.
alter function public.platform_release_readiness()
  rename to platform_release_readiness_20260902194106;
alter function public.platform_release_readiness_20260902194106() set schema app;
revoke all on function app.platform_release_readiness_20260902194106()
  from public, anon, authenticated;
grant execute on function app.platform_release_readiness_20260902194106() to service_role;

create or replace function public.platform_release_readiness()
returns text language plpgsql stable security invoker set search_path = '' as $$
begin
  if app.platform_release_readiness_20260902194106() <> '20260902194106' then
    raise exception 'device wall channel prerequisite is incomplete';
  end if;
  if exists (
    select 1 from public.brands brand
    where brand.stored_value is true
      and not exists (
        select 1 from public.module_installations installation
        where installation.brand_id = brand.id
          and installation.module_key = 'growth-stored-value'
          and installation.state = 'active'
      )
  ) then raise exception 'legacy stored_value flag is not fully backfilled'; end if;
  if exists (
    select 1 from public.brands brand
    where brand.referrals is true
      and not exists (
        select 1 from public.module_installations installation
        where installation.brand_id = brand.id
          and installation.module_key = 'growth-referrals'
          and installation.state = 'active'
      )
  ) then raise exception 'legacy referrals flag is not fully backfilled'; end if;
  if exists (
    select 1 from public.brands brand
    where brand.drops is true
      and not exists (
        select 1 from public.module_installations installation
        where installation.brand_id = brand.id
          and installation.module_key = 'growth-drops'
          and installation.state = 'active'
      )
  ) then raise exception 'legacy drops flag is not fully backfilled'; end if;
  if exists (
    select 1 from public.brands brand
    where brand.catering is true
      and not exists (
        select 1 from public.module_installations installation
        where installation.brand_id = brand.id
          and installation.module_key = 'commerce-catering'
          and installation.state = 'active'
      )
  ) then raise exception 'legacy catering flag is not fully backfilled'; end if;
  if exists (
    select 1 from public.brands brand
    where brand.delivery is true
      and not exists (
        select 1 from public.module_installations installation
        where installation.brand_id = brand.id
          and installation.module_key = 'commerce-delivery'
          and installation.state = 'active'
      )
  ) then raise exception 'legacy delivery flag is not fully backfilled'; end if;
  if exists (
    select 1 from public.brands brand
    where brand.operations is true
      and not exists (
        select 1 from public.module_installations installation
        where installation.brand_id = brand.id
          and installation.module_key = 'workforce-operations'
          and installation.state = 'active'
      )
  ) then raise exception 'legacy operations flag is not fully backfilled'; end if;
  return '20260902220257';
end $$;
revoke all on function public.platform_release_readiness() from public, anon, authenticated;
grant execute on function public.platform_release_readiness() to service_role;
