-- One production contract for creating and operating franchise tenants.
-- The browser submits one idempotency key; Postgres owns the brand, first
-- location, owner membership, network agreement, module set, readiness ledger,
-- and immutable access event in a single transaction. External providers are
-- represented as explicit readiness checks and can never be reported complete
-- without evidence from a service-role worker.

alter table public.brands drop constraint brands_status_is_known;
alter table public.brands
  add constraint brands_status_is_known
    check (status in ('provisioning', 'active', 'suspended', 'offboarded')),
  add column organization_kind text not null default 'independent'
    constraint brands_organization_kind_is_known
    check (organization_kind in ('independent', 'franchisor', 'franchisee', 'operator')),
  add column industry_key text not null default 'general'
    constraint brands_industry_key_is_slug
    check (industry_key ~ '^[a-z][a-z0-9-]{1,48}[a-z0-9]$'),
  add column blueprint_key text not null default 'blank'
    constraint brands_blueprint_key_is_slug
    check (blueprint_key ~ '^[a-z][a-z0-9-]{1,48}[a-z0-9]$');

alter table public.brands alter column fee_bps set default 200;
alter table public.brands alter column fee_bps_tier2 set default 150;
alter table public.brands alter column tier_threshold_cents set default 2500000;

-- A client may read and update its brand through the existing narrowly
-- validated settings RPCs, but creation and deletion are platform workflows.
revoke insert, delete on table public.brands from anon, authenticated;
drop policy if exists brands_insert on public.brands;
drop policy if exists brands_delete on public.brands;

create table public.organization_provisioning_runs (
  id uuid primary key default gen_random_uuid(),
  idempotency_key uuid not null unique,
  brand_id uuid unique references public.brands (id) on delete restrict,
  requested_by uuid not null references auth.users (id) on delete restrict,
  owner_user_id uuid references auth.users (id) on delete restrict,
  owner_email text not null check (
    length(owner_email) between 3 and 254 and owner_email = lower(owner_email)
  ),
  stage text not null default 'started'
    check (stage in ('started', 'database_ready', 'awaiting_external', 'ready', 'active', 'failed')),
  error_code text check (error_code is null or error_code ~ '^[a-z][a-z0-9_]{2,63}$'),
  request jsonb not null check (
    jsonb_typeof(request) = 'object' and octet_length(request::text) <= 32768
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger organization_provisioning_runs_touch
before update on public.organization_provisioning_runs
for each row execute function app.touch_updated_at();

create table public.organization_readiness_checks (
  brand_id uuid not null references public.brands (id) on delete restrict,
  check_key text not null check (check_key ~ '^[a-z][a-z0-9_.-]{1,62}[a-z0-9]$'),
  required boolean not null default true,
  status text not null default 'pending' check (status in ('pending', 'passed', 'failed')),
  evidence jsonb not null default '{}'::jsonb check (
    jsonb_typeof(evidence) = 'object' and octet_length(evidence::text) <= 16384
  ),
  checked_by uuid references auth.users (id) on delete restrict,
  checked_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (brand_id, check_key),
  check ((status = 'pending' and checked_at is null) or (status <> 'pending' and checked_at is not null))
);

create trigger organization_readiness_checks_touch
before update on public.organization_readiness_checks
for each row execute function app.touch_updated_at();

alter table public.franchise_networks
  add column config_revision integer not null default 1 check (config_revision >= 1),
  add column inheritance_policy jsonb not null default '{}'::jsonb check (
    jsonb_typeof(inheritance_policy) = 'object'
    and octet_length(inheritance_policy::text) <= 16384
  );

alter table public.franchise_network_brands
  add column status text not null default 'active'
    check (status in ('pending', 'active', 'rejected', 'revoked')),
  add column accepted_by uuid references auth.users (id) on delete restrict,
  add column accepted_at timestamptz,
  add column updated_at timestamptz not null default now(),
  add constraint franchise_network_brand_acceptance_consistent check (
    (status = 'active' and accepted_at is not null and accepted_by is not null)
    or status <> 'active'
  ) not valid;

-- Existing rows predate consent tracking. Their platform-admin creator is the
-- only durable approval identity available, so preserve it explicitly.
update public.franchise_network_brands member_brand
set accepted_by = member_brand.added_by,
    accepted_at = member_brand.created_at
where member_brand.status = 'active' and member_brand.added_by is not null;
update public.franchise_network_brands member_brand
set status = 'pending'
where member_brand.status = 'active' and member_brand.accepted_by is null;
alter table public.franchise_network_brands
  validate constraint franchise_network_brand_acceptance_consistent;

create trigger franchise_network_brands_touch
before update on public.franchise_network_brands
for each row execute function app.touch_updated_at();

create table public.franchise_agreements (
  id uuid primary key default gen_random_uuid(),
  network_id uuid not null references public.franchise_networks (id) on delete restrict,
  franchisor_brand_id uuid references public.brands (id) on delete restrict,
  franchisee_brand_id uuid not null references public.brands (id) on delete restrict,
  status text not null default 'pending'
    check (status in ('pending', 'active', 'rejected', 'suspended', 'terminated')),
  territory jsonb not null default '{}'::jsonb check (
    jsonb_typeof(territory) = 'object' and octet_length(territory::text) <= 8192
  ),
  inheritance_policy jsonb not null default '{}'::jsonb check (
    jsonb_typeof(inheritance_policy) = 'object'
    and octet_length(inheritance_policy::text) <= 16384
  ),
  inheritance_revision integer not null default 1 check (inheritance_revision >= 1),
  accepted_by uuid references auth.users (id) on delete restrict,
  effective_at timestamptz,
  terminated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (network_id, franchisee_brand_id),
  check ((status = 'active' and accepted_by is not null and effective_at is not null)
    or status <> 'active'),
  check ((status = 'terminated' and terminated_at is not null) or status <> 'terminated')
);

create trigger franchise_agreements_touch before update on public.franchise_agreements
for each row execute function app.touch_updated_at();

create index organization_provisioning_runs_requested_by_idx
  on public.organization_provisioning_runs (requested_by);
create index organization_provisioning_runs_owner_user_id_idx
  on public.organization_provisioning_runs (owner_user_id);
create index organization_readiness_checks_checked_by_idx
  on public.organization_readiness_checks (checked_by) where checked_by is not null;
create index franchise_network_brands_accepted_by_idx
  on public.franchise_network_brands (accepted_by) where accepted_by is not null;
create index franchise_agreements_franchisor_brand_id_idx
  on public.franchise_agreements (franchisor_brand_id) where franchisor_brand_id is not null;
create index franchise_agreements_franchisee_brand_id_idx
  on public.franchise_agreements (franchisee_brand_id);
create index franchise_agreements_accepted_by_idx
  on public.franchise_agreements (accepted_by) where accepted_by is not null;

-- Tenant manifests may narrow a module to any non-empty subset of the five
-- platform surfaces. Persist that decision instead of silently expanding every
-- installation to the registry-wide maximum.
create or replace function app.is_valid_application_surface_set(p_surfaces text[])
returns boolean language sql immutable strict security invoker set search_path = '' as $$
  select cardinality(p_surfaces) between 1 and 5
    and p_surfaces <@ array['customer', 'kiosk', 'operator', 'display', 'hq']::text[]
    and cardinality(p_surfaces) = (
      select count(distinct surface)::integer from unnest(p_surfaces) surface
    )
$$;
revoke all on function app.is_valid_application_surface_set(text[])
  from public, anon, authenticated;
grant execute on function app.is_valid_application_surface_set(text[]) to service_role;

alter table public.module_installations add column surfaces text[];
select pg_catalog.set_config('app.module_installation_writer', 'guarded', true);
update public.module_installations installation
set surfaces = registry.surfaces
from app.module_registry registry
where registry.module_key = installation.module_key;
select pg_catalog.set_config('app.module_installation_writer', '', true);
alter table public.module_installations
  alter column surfaces set not null,
  add constraint module_installations_surfaces_are_valid
    check (app.is_valid_application_surface_set(surfaces));

create or replace function app.validate_module_installation_surfaces() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare registered_surfaces text[];
begin
  select registry.surfaces into registered_surfaces
  from app.module_registry registry where registry.module_key = new.module_key;
  if registered_surfaces is null then
    raise exception using errcode = '23503', message = 'module_not_registered';
  end if;
  if not app.is_valid_application_surface_set(new.surfaces)
     or not new.surfaces <@ registered_surfaces then
    raise exception using errcode = '22023', message = 'module_surfaces_not_supported';
  end if;
  return new;
end $$;
revoke all on function app.validate_module_installation_surfaces()
  from public, anon, authenticated;
create trigger module_installations_surface_contract
before insert or update of module_key, surfaces on public.module_installations
for each row execute function app.validate_module_installation_surfaces();

-- The hosted factory reads these rows, so keep the SQL blueprint mirror as
-- complete as the repository blueprint. Both launch blueprints can drive the
-- complete five-surface platform; enabled modules still narrow their own use.
update public.industry_blueprints blueprint set manifest = blueprint.manifest || jsonb_build_object(
  'applicationSurfaces', jsonb_build_array('hq', 'display', 'customer', 'operator', 'kiosk'),
  'recommendedModules', jsonb_build_array(
    'commerce-catalog', 'commerce-ordering', 'commerce-payments',
    'workforce-operations', 'workforce-training', 'device-wall'
  )
), updated_at = now()
where blueprint.industry_key = 'coffee-shop' and blueprint.version = 1;

insert into public.industry_blueprints (
  industry_key, version, name, locale, supabase_region, manifest, status
) values (
  'general', 1, 'Blank', 'en-US', 'us-west-1',
  jsonb_build_object(
    'schemaVersion', 1, 'key', 'blank', 'name', 'Blank',
    'templateVersion', 1, 'locale', 'en-US', 'supabaseRegion', 'us-west-1',
    'applicationSurfaces', jsonb_build_array('hq', 'display', 'customer', 'operator', 'kiosk'),
    'recommendedModules', jsonb_build_array(),
    'vocabulary', jsonb_build_object(
      'catalog', 'Catalog', 'folder', 'Group',
      'offering', 'Offering', 'resource', 'Resource'
    )
  ), 'active'
)
on conflict (industry_key, version) do update set
  name = excluded.name, locale = excluded.locale,
  supabase_region = excluded.supabase_region, manifest = excluded.manifest,
  status = excluded.status, updated_at = now();

insert into public.industry_blueprints (
  industry_key, version, name, locale, supabase_region, manifest, status
) values (
  'construction', 1, 'Construction', 'en-US', 'us-west-1',
  jsonb_build_object(
    'schemaVersion', 1, 'key', 'construction', 'name', 'Construction',
    'templateVersion', 1, 'locale', 'en-US', 'supabaseRegion', 'us-west-1',
    'applicationSurfaces', jsonb_build_array('hq', 'display', 'customer', 'operator', 'kiosk'),
    'recommendedModules', jsonb_build_array(
      'construction-projects', 'workforce-operations', 'workforce-training',
      'commerce-catalog', 'commerce-ordering', 'commerce-payments',
      'local-printing', 'device-wall'
    ),
    'vocabulary', jsonb_build_object(
      'catalog', 'Service catalog', 'folder', 'Service group',
      'offering', 'Service', 'resource', 'Procedure'
    )
  ), 'active'
)
on conflict (industry_key, version) do update set
  name = excluded.name, locale = excluded.locale,
  supabase_region = excluded.supabase_region, manifest = excluded.manifest,
  status = excluded.status, updated_at = now();

-- Event rows must name the same tenant as their installation.
alter table public.module_installations
  add constraint module_installations_id_brand_key unique (id, brand_id);
alter table public.module_installation_events
  add constraint module_installation_events_installation_brand_fk
  foreign key (installation_id, brand_id)
  references public.module_installations (id, brand_id) on delete cascade;
create index module_installation_events_installation_brand_fk_idx
  on public.module_installation_events (installation_id, brand_id);

alter table public.delegated_access_grants
  add column idempotency_key uuid,
  add constraint delegated_grants_expire_after_creation
    check (expires_at > created_at);
create unique index delegated_access_grants_idempotency_idx
  on public.delegated_access_grants (created_by, idempotency_key)
  where idempotency_key is not null;

alter table public.organization_provisioning_runs enable row level security;
alter table public.organization_readiness_checks enable row level security;
alter table public.franchise_agreements enable row level security;

create policy organization_provisioning_runs_select on public.organization_provisioning_runs
  for select to authenticated using (app.is_platform_admin());
create policy organization_readiness_checks_select on public.organization_readiness_checks
  for select to authenticated using (app.is_platform_admin() or app.is_brand_owner(brand_id));
create policy franchise_agreements_select on public.franchise_agreements
  for select to authenticated using (
    app.is_brand_owner(franchisee_brand_id)
    or app.is_franchise_network_member(network_id, (select auth.uid()))
  );

drop policy franchise_networks_select on public.franchise_networks;
create policy franchise_networks_select on public.franchise_networks
  for select to authenticated using (
    app.is_platform_admin()
    or app.is_franchise_network_member(id, (select auth.uid()))
  );
drop policy franchise_memberships_select on public.franchise_memberships;
create policy franchise_memberships_select on public.franchise_memberships
  for select to authenticated using (
    app.is_platform_admin()
    or user_id = (select auth.uid())
    or app.is_franchise_network_admin(network_id, (select auth.uid()))
  );
drop policy franchise_network_brands_select on public.franchise_network_brands;
create policy franchise_network_brands_select on public.franchise_network_brands
  for select to authenticated using (
    app.is_platform_admin()
    or app.is_franchise_network_admin(network_id, (select auth.uid()))
    or app.is_brand_owner(brand_id)
    or (
      status = 'active'
      and app.is_franchise_network_member(network_id, (select auth.uid()))
    )
  );

grant select on public.organization_provisioning_runs,
  public.organization_readiness_checks, public.franchise_agreements to authenticated;
revoke insert, update, delete on public.organization_provisioning_runs,
  public.organization_readiness_checks, public.franchise_agreements from anon, authenticated;

-- Retire the partial browser creation route and the non-idempotent grant
-- overload. Service migrations retain ownership-level access when needed.
revoke execute on function public.create_platform_organization(text, text, jsonb, uuid)
  from authenticated;
revoke execute on function public.grant_delegated_access(
  uuid, uuid, uuid, text[], timestamptz
) from authenticated;

-- Extend the guarded insertion root with a surface-aware overload. The legacy
-- six-argument entry point remains available to existing trusted callers and
-- resolves to the registry maximum.
create or replace function app.create_module_installation(
  p_brand_id uuid,
  p_module_key text,
  p_version text,
  p_config jsonb,
  p_actor uuid,
  p_correlation_id uuid,
  p_surfaces text[]
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare installation_id uuid;
declare registered_surfaces text[];
declare selected_surfaces text[];
begin
  if p_config is not null and (
    jsonb_typeof(p_config) is distinct from 'object'
    or octet_length(p_config::text) > 16384
  ) then raise exception using errcode = '22023', message = 'invalid_module_config'; end if;
  select registry.surfaces into registered_surfaces
  from app.module_registry registry where registry.module_key = p_module_key;
  if registered_surfaces is null then
    raise exception using errcode = '23503', message = 'module_not_registered';
  end if;
  selected_surfaces := coalesce(p_surfaces, registered_surfaces);
  if not app.is_valid_application_surface_set(selected_surfaces)
     or not selected_surfaces <@ registered_surfaces then
    raise exception using errcode = '22023', message = 'module_surfaces_not_supported';
  end if;
  perform pg_catalog.set_config('app.module_installation_writer', 'guarded', true);
  insert into public.module_installations (
    brand_id, module_key, version, config, installed_by, surfaces
  ) values (
    p_brand_id, p_module_key, p_version, coalesce(p_config, '{}'::jsonb),
    p_actor, selected_surfaces
  ) returning id into installation_id;
  perform pg_catalog.set_config('app.module_installation_writer', '', true);
  insert into public.module_installation_events (
    installation_id, brand_id, event, from_state, to_state,
    config_revision, actor, detail
  ) values (
    installation_id, p_brand_id, 'installed', null, 'draft', 1, p_actor,
    jsonb_build_object('correlation_id', p_correlation_id, 'surfaces', selected_surfaces)
  );
  return installation_id;
end $$;
revoke all on function app.create_module_installation(
  uuid, text, text, jsonb, uuid, uuid, text[]
) from public, anon, authenticated;
grant execute on function app.create_module_installation(
  uuid, text, text, jsonb, uuid, uuid, text[]
) to service_role;

create or replace function app.create_module_installation(
  p_brand_id uuid, p_module_key text, p_version text, p_config jsonb,
  p_actor uuid, p_correlation_id uuid
) returns uuid
language sql security definer set search_path = '' as $$
  select app.create_module_installation(
    p_brand_id, p_module_key, p_version, p_config,
    p_actor, p_correlation_id, null::text[]
  )
$$;
revoke all on function app.create_module_installation(uuid, text, text, jsonb, uuid, uuid)
  from public, anon, authenticated;
grant execute on function app.create_module_installation(uuid, text, text, jsonb, uuid, uuid)
  to service_role;

-- Serialize first-install retries. A repeated request must describe the same
-- immutable first installation; reconciliation owns later config changes.
create or replace function public.install_brand_module(
  p_brand_id uuid,
  p_module_key text,
  p_version text,
  p_config jsonb,
  p_surfaces text[]
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare existing public.module_installations%rowtype;
declare installation_id uuid;
declare revision integer;
declare registered_surfaces text[];
declare selected_surfaces text[];
begin
  select registry.surfaces into registered_surfaces
  from app.module_registry registry where registry.module_key = p_module_key;
  if registered_surfaces is null then
    raise exception using errcode = '23503', message = 'module_not_registered';
  end if;
  selected_surfaces := coalesce(p_surfaces, registered_surfaces);
  if not app.is_valid_application_surface_set(selected_surfaces)
     or not selected_surfaces <@ registered_surfaces then
    raise exception using errcode = '22023', message = 'module_surfaces_not_supported';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_brand_id::text || ':' || p_module_key, 0)
  );
  select * into existing from public.module_installations target
  where target.brand_id = p_brand_id and target.module_key = p_module_key for update;
  if found then
    if existing.version is distinct from p_version
       or existing.config is distinct from coalesce(p_config, '{}'::jsonb)
       or existing.surfaces is distinct from selected_surfaces then
      raise exception using errcode = '22023', message = 'module_installation_request_conflict';
    end if;
    return existing.id;
  end if;
  installation_id := app.create_module_installation(
    p_brand_id, p_module_key, p_version, p_config, null, gen_random_uuid(), selected_surfaces
  );
  revision := app.set_module_installation_state(
    installation_id, p_brand_id, 'validating', null, 1, null, gen_random_uuid()
  );
  perform app.set_module_installation_state(
    installation_id, p_brand_id, 'active', null, revision, null, gen_random_uuid()
  );
  return installation_id;
end $$;
revoke all on function public.install_brand_module(uuid, text, text, jsonb, text[])
  from public, anon, authenticated;
grant execute on function public.install_brand_module(uuid, text, text, jsonb, text[])
  to service_role;

create or replace function public.install_brand_module(
  p_brand_id uuid,
  p_module_key text,
  p_version text default '1.0.0',
  p_config jsonb default '{}'::jsonb
) returns uuid
language sql security definer set search_path = '' as $$
  select public.install_brand_module(
    p_brand_id, p_module_key, p_version, p_config, null::text[]
  )
$$;
revoke all on function public.install_brand_module(uuid, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.install_brand_module(uuid, text, text, jsonb) to service_role;

-- The service reconciliation front door applies one complete desired module
-- set. Missing or explicitly disabled modules are disabled; active modules are
-- never silently reactivated from a human suspension/error state.
create or replace function public.reconcile_brand_modules(
  p_brand_id uuid,
  p_modules jsonb
) returns integer
language plpgsql security definer set search_path = '' as $$
declare spec jsonb;
declare installation public.module_installations%rowtype;
declare revision integer;
declare registered_surfaces text[];
declare requested_surfaces text[];
declare desired_keys text[] := '{}'::text[];
declare changed integer := 0;
begin
  if jsonb_typeof(p_modules) is distinct from 'array'
     or jsonb_array_length(p_modules) > 64 then
    raise exception using errcode = '22023', message = 'invalid_module_manifest';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_brand_id::text || ':module-reconcile', 0)
  );
  for spec in select value from jsonb_array_elements(p_modules) loop
    revision := null;
    if jsonb_typeof(spec) is distinct from 'object'
       or spec->>'key' !~ '^[a-z][a-z0-9-]{1,48}[a-z0-9]$'
       or spec->>'version' !~ '^\d+\.\d+\.\d+$'
       or jsonb_typeof(coalesce(spec->'enabled', 'true'::jsonb)) is distinct from 'boolean'
       or jsonb_typeof(coalesce(spec->'config', '{}'::jsonb)) is distinct from 'object'
       or octet_length(coalesce(spec->'config', '{}'::jsonb)::text) > 16384
       or (spec ? 'config_schema_version' and spec->>'config_schema_version' <> '1')
       or (spec ? 'surfaces'
         and jsonb_typeof(spec->'surfaces') is distinct from 'array'
         and jsonb_typeof(spec->'surfaces') is distinct from 'null') then
      raise exception using errcode = '22023', message = 'invalid_module_manifest';
    end if;
    if (spec->>'key') = any(desired_keys) then
      raise exception using errcode = '22023', message = 'duplicate_module_manifest_key';
    end if;
    desired_keys := array_append(desired_keys, spec->>'key');
    select registry.surfaces into registered_surfaces
    from app.module_registry registry where registry.module_key = spec->>'key';
    if registered_surfaces is null then
      raise exception using errcode = '23503', message = 'module_not_registered';
    end if;
    if jsonb_typeof(spec->'surfaces') = 'array' then
      if jsonb_array_length(spec->'surfaces') not between 1 and 5
         or exists (
           select 1 from jsonb_array_elements(spec->'surfaces') surface
           where jsonb_typeof(surface) <> 'string'
         ) then
        raise exception using errcode = '22023', message = 'module_surfaces_not_supported';
      end if;
      select array_agg(surface order by array_position(
        array['customer', 'kiosk', 'operator', 'display', 'hq']::text[], surface
      )) into requested_surfaces
      from (select jsonb_array_elements_text(spec->'surfaces') surface) declared;
    else
      requested_surfaces := registered_surfaces;
    end if;
    if not app.is_valid_application_surface_set(requested_surfaces)
       or not requested_surfaces <@ registered_surfaces then
      raise exception using errcode = '22023', message = 'module_surfaces_not_supported';
    end if;
    select * into installation from public.module_installations target
    where target.brand_id = p_brand_id and target.module_key = spec->>'key' for update;
    if not found then
      if coalesce((spec->>'enabled')::boolean, true) then
        perform public.install_brand_module(
          p_brand_id, spec->>'key', spec->>'version',
          coalesce(spec->'config', '{}'::jsonb), requested_surfaces
        );
        changed := changed + 1;
      end if;
    else
      if installation.version is distinct from spec->>'version'
         or installation.config is distinct from coalesce(spec->'config', '{}'::jsonb)
         or installation.surfaces is distinct from requested_surfaces then
        perform pg_catalog.set_config('app.module_installation_writer', 'guarded', true);
        update public.module_installations target set
          version = spec->>'version',
          config = coalesce(spec->'config', '{}'::jsonb),
          surfaces = requested_surfaces,
          config_revision = target.config_revision + 1
        where target.id = installation.id
        returning config_revision into revision;
        perform pg_catalog.set_config('app.module_installation_writer', '', true);
        insert into public.module_installation_events (
          installation_id, brand_id, event, from_state, to_state,
          config_revision, actor, detail
        ) values (
          installation.id, p_brand_id, 'config.reconciled', installation.state,
          installation.state, revision, null,
          jsonb_build_object('source', 'tenant_manifest', 'surfaces', requested_surfaces)
        );
        changed := changed + 1;
      end if;
      if not coalesce((spec->>'enabled')::boolean, true)
         and installation.state <> 'disabled' then
        perform app.set_module_installation_state(
          installation.id, p_brand_id, 'disabled', null,
          coalesce(revision, installation.config_revision), null, gen_random_uuid()
        );
        changed := changed + 1;
      end if;
    end if;
  end loop;
  for installation in select * from public.module_installations target
    where target.brand_id = p_brand_id
      and not (target.module_key = any(desired_keys))
      and target.state <> 'disabled' for update
  loop
    perform app.set_module_installation_state(
      installation.id, p_brand_id, 'disabled', null,
      installation.config_revision, null, gen_random_uuid()
    );
    changed := changed + 1;
  end loop;
  return changed;
end $$;
revoke all on function public.reconcile_brand_modules(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.reconcile_brand_modules(uuid, jsonb) to service_role;

-- Anonymous capability reads honor the tenant's narrowed deployment surfaces,
-- and provisioning/suspended tenants never leak a storefront declaration.
create or replace function app.brand_storefront_capability_rows(p_slug text)
returns table (slug text, module_key text)
language sql stable security definer set search_path = '' as $$
  select brand.slug, installation.module_key
  from public.brands brand
  join public.module_installations installation on installation.brand_id = brand.id
  join app.module_registry registry on registry.module_key = installation.module_key
  where p_slug is not null
    and brand.slug = p_slug
    and brand.status = 'active'
    and installation.state = 'active'
    and 'customer' = any (registry.surfaces)
    and 'customer' = any (installation.surfaces)
$$;
revoke all on function app.brand_storefront_capability_rows(text) from public;
grant execute on function app.brand_storefront_capability_rows(text)
  to anon, authenticated, service_role;

-- Replace unilateral network enrollment with consent. Platform and network
-- administrators create a pending request and agreement which a brand owner
-- must accept together.
create or replace function public.enroll_brand_in_network(
  p_network_id uuid,
  p_brand_id uuid
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := (select auth.uid());
declare platform_actor boolean;
declare franchisor_brand_id uuid;
begin
  platform_actor := exists (
    select 1 from public.brand_users member
    where member.user_id = actor_id and member.role = 'platform_admin'
  );
  if actor_id is null or not (
    platform_actor or app.is_franchise_network_admin(p_network_id, actor_id)
  ) then raise exception using errcode = '42501', message = 'network_admin_required'; end if;
  if not exists (select 1 from public.franchise_networks where id = p_network_id) then
    raise exception using errcode = '23503', message = 'franchise_network_not_found';
  end if;
  if not exists (select 1 from public.brands where id = p_brand_id) then
    raise exception using errcode = '23503', message = 'franchise_brand_not_found';
  end if;
  if exists (
    select 1
    from public.franchise_network_brands member_brand
    join public.franchise_agreements agreement
      on agreement.network_id = member_brand.network_id
      and agreement.franchisee_brand_id = member_brand.brand_id
    where member_brand.network_id = p_network_id
      and member_brand.brand_id = p_brand_id
      and member_brand.status = 'active'
      and agreement.status = 'active'
  ) then return true; end if;
  select member_brand.brand_id into franchisor_brand_id
  from public.franchise_network_brands member_brand
  join public.brands brand on brand.id = member_brand.brand_id
  where member_brand.network_id = p_network_id
    and member_brand.status = 'active'
    and brand.organization_kind = 'franchisor'
  order by member_brand.created_at limit 1;
  insert into public.franchise_network_brands (
    network_id, brand_id, added_by, status, accepted_by, accepted_at
  ) values (
    p_network_id, p_brand_id, actor_id, 'pending', null, null
  ) on conflict (network_id, brand_id) do update set
    added_by = excluded.added_by,
    status = 'pending', accepted_by = null, accepted_at = null;
  insert into public.franchise_agreements (
    network_id, franchisor_brand_id, franchisee_brand_id, status,
    territory, inheritance_policy, accepted_by, effective_at
  ) values (
    p_network_id, franchisor_brand_id, p_brand_id, 'pending',
    '{}'::jsonb, '{}'::jsonb, null, null
  ) on conflict (network_id, franchisee_brand_id) do update set
    franchisor_brand_id = coalesce(excluded.franchisor_brand_id,
      public.franchise_agreements.franchisor_brand_id),
    status = 'pending', accepted_by = null, effective_at = null,
    terminated_at = null;
  return true;
end $$;
revoke all on function public.enroll_brand_in_network(uuid, uuid) from public, anon;
grant execute on function public.enroll_brand_in_network(uuid, uuid) to authenticated, service_role;

create or replace function public.respond_to_network_enrollment(
  p_network_id uuid,
  p_brand_id uuid,
  p_accept boolean
) returns text
language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := (select auth.uid());
declare next_status text := case when p_accept then 'active' else 'rejected' end;
begin
  if actor_id is null or not exists (
    select 1 from public.brand_users member
    where member.user_id = actor_id and member.brand_id = p_brand_id
      and member.role = 'brand_owner'
  ) then raise exception using errcode = '42501', message = 'brand_owner_required'; end if;
  update public.franchise_agreements agreement set
    status = next_status,
    accepted_by = case when p_accept then actor_id end,
    effective_at = case when p_accept then now() end
  where agreement.network_id = p_network_id
    and agreement.franchisee_brand_id = p_brand_id
    and agreement.status = 'pending';
  if not found then raise exception using errcode = '23503', message = 'pending_agreement_not_found'; end if;
  update public.franchise_network_brands member_brand set
    status = next_status,
    accepted_by = case when p_accept then actor_id end,
    accepted_at = case when p_accept then now() end
  where member_brand.network_id = p_network_id
    and member_brand.brand_id = p_brand_id and member_brand.status = 'pending';
  if not found then raise exception using errcode = '23503', message = 'pending_enrollment_not_found'; end if;
  return next_status;
end $$;
revoke all on function public.respond_to_network_enrollment(uuid, uuid, boolean) from public, anon;
grant execute on function public.respond_to_network_enrollment(uuid, uuid, boolean) to authenticated;

create or replace function public.manage_franchise_member(
  p_network_id uuid,
  p_user_id uuid,
  p_role text,
  p_remove boolean default false
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := (select auth.uid());
declare membership_role text;
begin
  if actor_id is null or not app.is_franchise_network_admin(p_network_id, actor_id) then
    raise exception using errcode = '42501', message = 'network_admin_required';
  end if;
  if p_role not in ('franchisor_admin', 'franchisor_analyst') then
    raise exception using errcode = '22023', message = 'invalid_franchise_role';
  end if;
  perform 1 from public.franchise_networks where id = p_network_id for update;
  select role into membership_role from public.franchise_memberships
  where network_id = p_network_id and user_id = p_user_id for update;
  if p_remove and membership_role is null then return false; end if;
  if membership_role = 'franchisor_admin' and (p_remove or p_role <> 'franchisor_admin')
     and not exists (
       select 1 from public.franchise_memberships
       where network_id = p_network_id and role = 'franchisor_admin'
         and user_id <> p_user_id
     ) then raise exception using errcode = '23514', message = 'last_franchisor_admin_required'; end if;
  if p_remove then
    delete from public.franchise_memberships
    where network_id = p_network_id and user_id = p_user_id;
  else
    insert into public.franchise_memberships (network_id, user_id, role)
    values (p_network_id, p_user_id, p_role)
    on conflict (network_id, user_id) do update set role = excluded.role;
  end if;
  return true;
end $$;
revoke all on function public.manage_franchise_member(uuid, uuid, text, boolean) from public, anon;
grant execute on function public.manage_franchise_member(uuid, uuid, text, boolean) to authenticated;

create or replace function public.unenroll_brand_from_network(
  p_network_id uuid,
  p_brand_id uuid
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := (select auth.uid());
begin
  if actor_id is null or not (
    app.is_platform_admin()
    or app.is_franchise_network_admin(p_network_id, actor_id)
    or exists (
      select 1 from public.brand_users member where member.user_id = actor_id
        and member.brand_id = p_brand_id and member.role = 'brand_owner'
    )
  ) then raise exception using errcode = '42501', message = 'network_unenroll_denied'; end if;
  update public.franchise_network_brands set status = 'revoked'
  where network_id = p_network_id and brand_id = p_brand_id and status <> 'revoked';
  if not found then return false; end if;
  update public.franchise_agreements set status = 'suspended'
  where network_id = p_network_id and franchisee_brand_id = p_brand_id and status = 'active';
  update public.delegated_access_grants set revoked_at = least(now(), expires_at)
  where network_id = p_network_id and brand_id = p_brand_id and revoked_at is null;
  return true;
end $$;
revoke all on function public.unenroll_brand_from_network(uuid, uuid) from public, anon;
grant execute on function public.unenroll_brand_from_network(uuid, uuid) to authenticated;

-- Retry-safe delegated grants. The legacy five-argument RPC remains for old
-- callers; new surfaces pass a stable UUID to this overload.
create or replace function public.grant_delegated_access(
  p_network_id uuid,
  p_brand_id uuid,
  p_grantee_user_id uuid,
  p_scope text[],
  p_expires_at timestamptz,
  p_idempotency_key uuid
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := (select auth.uid());
declare grant_id uuid;
declare existing_grant public.delegated_access_grants%rowtype;
begin
  if actor_id is null or not (app.is_platform_admin() or app.is_brand_owner(p_brand_id)) then
    raise exception using errcode = '42501', message = 'brand_owner_required';
  end if;
  if p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'invalid_delegated_grant';
  end if;
  select * into existing_grant from public.delegated_access_grants
  where created_by = actor_id and idempotency_key = p_idempotency_key;
  if found then
    if existing_grant.network_id is distinct from p_network_id
       or existing_grant.brand_id is distinct from p_brand_id
       or existing_grant.grantee_user_id is distinct from p_grantee_user_id
       or existing_grant.scope is distinct from p_scope
       or existing_grant.expires_at is distinct from p_expires_at then
      raise exception using errcode = '22023', message = 'idempotency_key_payload_mismatch';
    end if;
    return existing_grant.id;
  end if;
  if p_grantee_user_id is null or p_grantee_user_id = actor_id
     or p_scope is null or cardinality(p_scope) not between 1 and 32
     or not app.valid_delegated_scope(p_scope)
     or p_expires_at <= now() or p_expires_at > now() + interval '30 days' then
    raise exception using errcode = '22023', message = 'invalid_delegated_grant';
  end if;
  if not exists (
    select 1 from public.franchise_network_brands member_brand
    where member_brand.network_id = p_network_id and member_brand.brand_id = p_brand_id
      and member_brand.status = 'active'
  ) then raise exception using errcode = '23514', message = 'delegated_brand_outside_network'; end if;
  insert into public.delegated_access_grants (
    brand_id, network_id, grantee_user_id, scope, created_by, expires_at, idempotency_key
  ) values (
    p_brand_id, p_network_id, p_grantee_user_id, p_scope, actor_id,
    p_expires_at, p_idempotency_key
  ) on conflict (created_by, idempotency_key) where idempotency_key is not null
  do nothing returning id into grant_id;
  if grant_id is null then
    select * into existing_grant from public.delegated_access_grants
    where created_by = actor_id and idempotency_key = p_idempotency_key;
    if existing_grant.network_id is distinct from p_network_id
       or existing_grant.brand_id is distinct from p_brand_id
       or existing_grant.grantee_user_id is distinct from p_grantee_user_id
       or existing_grant.scope is distinct from p_scope
       or existing_grant.expires_at is distinct from p_expires_at then
      raise exception using errcode = '22023', message = 'idempotency_key_payload_mismatch';
    end if;
    grant_id := existing_grant.id;
  end if;
  return grant_id;
exception when foreign_key_violation then
  raise exception using errcode = '23503', message = 'delegated_grantee_not_found';
end $$;
revoke all on function public.grant_delegated_access(uuid, uuid, uuid, text[], timestamptz, uuid)
  from public, anon;
grant execute on function public.grant_delegated_access(uuid, uuid, uuid, text[], timestamptz, uuid)
  to authenticated, service_role;

-- Full organization provisioning transaction.
create or replace function public.provision_platform_organization(
  p_idempotency_key uuid,
  p_name text,
  p_slug text,
  p_owner_user_id uuid,
  p_owner_email text,
  p_organization_kind text,
  p_industry_key text,
  p_blueprint_key text,
  p_brand_config jsonb,
  p_location jsonb,
  p_modules jsonb,
  p_network_slug text default null,
  p_territory jsonb default '{}'::jsonb,
  p_inheritance_policy jsonb default '{}'::jsonb,
  p_fee_bps integer default 200,
  p_fee_bps_tier2 integer default 150,
  p_tier_threshold_cents bigint default 2500000
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := (select auth.uid());
declare run public.organization_provisioning_runs%rowtype;
declare created_brand_id uuid;
declare created_location_id uuid;
declare selected_network_id uuid;
declare franchisor_brand_id uuid;
declare requires_location boolean;
declare requires_payment_provider boolean;
declare request_payload jsonb;
declare request_fingerprint text;
declare declared_surfaces text[];
begin
  if actor_id is null or not exists (
    select 1 from public.brand_users member
    where member.user_id = actor_id and member.role = 'platform_admin'
  ) then raise exception using errcode = '42501', message = 'platform_actor_required'; end if;
  if p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'idempotency_key_required';
  end if;
  request_payload := jsonb_build_object(
    'name', btrim(p_name), 'slug', p_slug, 'ownerUserId', p_owner_user_id,
    'ownerEmail', lower(btrim(p_owner_email)), 'organizationKind', p_organization_kind,
    'industryKey', p_industry_key, 'blueprintKey', p_blueprint_key,
    'brandConfig', p_brand_config, 'location', p_location, 'modules', p_modules,
    'networkSlug', p_network_slug, 'territory', coalesce(p_territory, '{}'::jsonb),
    'inheritancePolicy', coalesce(p_inheritance_policy, '{}'::jsonb),
    'feeBps', p_fee_bps, 'feeBpsTier2', p_fee_bps_tier2,
    'tierThresholdCents', p_tier_threshold_cents
  );
  request_fingerprint := pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(request_payload::text, 'UTF8')), 'hex'
  );
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_idempotency_key::text, 0));
  select * into run from public.organization_provisioning_runs existing
  where existing.idempotency_key = p_idempotency_key for update;
  if found then
    if run.requested_by <> actor_id then
      raise exception using errcode = '42501', message = 'idempotency_key_owned_by_another_actor';
    end if;
    if run.request->>'requestFingerprint' is distinct from request_fingerprint then
      raise exception using errcode = '22023', message = 'idempotency_key_payload_mismatch';
    end if;
    return jsonb_build_object(
      'brandId', run.brand_id,
      'locationId', (run.request->>'locationId')::uuid,
      'networkId', (run.request->>'networkId')::uuid,
      'stage', run.stage,
      'replayed', true
    );
  end if;
  requires_location := p_organization_kind in ('independent', 'franchisee');
  if length(btrim(coalesce(p_name, ''))) not between 2 and 120
     or p_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' or length(p_slug) > 63
     or p_organization_kind not in ('independent', 'franchisor', 'franchisee', 'operator')
     or p_industry_key !~ '^[a-z][a-z0-9-]{1,48}[a-z0-9]$'
     or p_blueprint_key !~ '^[a-z][a-z0-9-]{1,48}[a-z0-9]$'
     or not (
       (p_industry_key = 'general' and p_blueprint_key = 'blank')
       or (p_industry_key = 'coffee-shop' and p_blueprint_key = 'coffee-shop')
       or (p_industry_key = 'construction' and p_blueprint_key = 'construction')
     )
     or p_owner_email is distinct from lower(btrim(p_owner_email))
     or length(p_owner_email) not between 3 and 254
     or position('@' in p_owner_email) < 2
     or jsonb_typeof(p_brand_config) is distinct from 'object'
     or octet_length(p_brand_config::text) > 16384
     or p_brand_config::text ~* '"[^\"]*(passcode|secret|password|api_key|apikey|access_token|refresh_token)[^\"]*"[[:space:]]*:'
     or jsonb_typeof(p_modules) is distinct from 'array'
     or jsonb_array_length(p_modules) > 64
     or jsonb_typeof(coalesce(p_territory, '{}'::jsonb)) is distinct from 'object'
     or jsonb_typeof(coalesce(p_inheritance_policy, '{}'::jsonb)) is distinct from 'object'
     or p_fee_bps not between 0 and 10000 or p_fee_bps_tier2 not between 0 and 10000
     or p_tier_threshold_cents < 0
     or (requires_location and jsonb_typeof(p_location) is distinct from 'object')
     or (p_organization_kind = 'franchisee' and (
       p_network_slug is null
       or p_network_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
       or length(p_network_slug) > 63
     )) then
    raise exception using errcode = '22023', message = 'invalid_organization_provisioning_request';
  end if;
  if not exists (
    select 1 from auth.users owner_user
    where owner_user.id = p_owner_user_id
      and lower(owner_user.email) = lower(btrim(p_owner_email))
  ) then
    raise exception using errcode = '23503', message = 'organization_owner_not_found';
  end if;
  if not exists (
    select 1 from public.industry_blueprints blueprint
    where blueprint.industry_key = p_industry_key
      and blueprint.status = 'active'
  ) then
    raise exception using errcode = '23503', message = 'active_industry_blueprint_not_found';
  end if;
  insert into public.organization_provisioning_runs (
    idempotency_key, requested_by, owner_user_id, owner_email, request
  ) values (
    p_idempotency_key, actor_id, p_owner_user_id, lower(btrim(p_owner_email)),
    jsonb_build_object('organizationKind', p_organization_kind,
      'industryKey', p_industry_key, 'blueprintKey', p_blueprint_key,
      'requestFingerprint', request_fingerprint)
  ) returning * into run;
  insert into public.brands (
    name, slug, status, organization_kind, industry_key, blueprint_key,
    fee_bps, fee_bps_tier2, tier_threshold_cents,
    drops, catering, delivery, multi_location, sms, stored_value, referrals,
    brand_config
  ) values (
    btrim(p_name), p_slug, 'provisioning', p_organization_kind,
    p_industry_key, p_blueprint_key, p_fee_bps, p_fee_bps_tier2,
    p_tier_threshold_cents, false, false, false, true, false, false, false,
    p_brand_config
  ) returning id into created_brand_id;
  update public.organization_provisioning_runs provisioning_run
  set brand_id = created_brand_id where provisioning_run.id = run.id;
  insert into public.brand_users (user_id, brand_id, role, location_ids)
  values (actor_id, created_brand_id, 'platform_admin', '{}'::uuid[]);
  insert into public.brand_users (user_id, brand_id, role, location_ids)
  values (p_owner_user_id, created_brand_id, 'brand_owner', '{}'::uuid[])
  on conflict (user_id, brand_id) do update set role = 'brand_owner', location_ids = '{}';
  if requires_location then
    if length(btrim(coalesce(p_location->>'name', ''))) not between 1 and 120
       or jsonb_typeof(coalesce(p_location->'address', '{}'::jsonb)) is distinct from 'object'
       or jsonb_typeof(coalesce(p_location->'hours', '{}'::jsonb)) is distinct from 'object'
       or length(coalesce(p_location->>'timezone', '')) not between 3 and 80 then
      raise exception using errcode = '22023', message = 'invalid_first_location';
    end if;
    insert into public.locations (brand_id, name, address, hours, timezone)
    values (created_brand_id, btrim(p_location->>'name'), coalesce(p_location->'address', '{}'::jsonb),
      coalesce(p_location->'hours', '{}'::jsonb), p_location->>'timezone')
    returning id into created_location_id;
  end if;
  perform public.reconcile_brand_modules(created_brand_id, p_modules);
  select exists (
    select 1
    from public.module_installations installation
    where installation.brand_id = created_brand_id
      and installation.module_key = 'commerce-payments'
      and installation.state = 'active'
  ) into requires_payment_provider;
  select array_agg(known.surface order by known.ordinality) into declared_surfaces
  from unnest(array['hq', 'display', 'customer', 'operator', 'kiosk']::text[])
    with ordinality known(surface, ordinality)
  where known.surface = 'hq' or exists (
    select 1 from public.module_installations installation
    where installation.brand_id = created_brand_id
      and installation.state = 'active'
      and known.surface = any(installation.surfaces)
  );
  if p_organization_kind = 'franchisor' then
    insert into public.franchise_networks (name, slug, inheritance_policy)
    values (btrim(p_name), p_slug, coalesce(p_inheritance_policy, '{}'::jsonb))
    returning id into selected_network_id;
    insert into public.franchise_memberships (network_id, user_id, role)
    values (selected_network_id, p_owner_user_id, 'franchisor_admin');
    insert into public.franchise_network_brands (
      network_id, brand_id, added_by, status, accepted_by, accepted_at
    ) values (
      selected_network_id, created_brand_id, actor_id, 'active', p_owner_user_id, now()
    );
  elsif p_organization_kind = 'franchisee' then
    select id into selected_network_id from public.franchise_networks
    where slug = p_network_slug for update;
    if selected_network_id is null then
      raise exception using errcode = '23503', message = 'franchise_network_not_found';
    end if;
    select member_brand.brand_id into franchisor_brand_id
    from public.franchise_network_brands member_brand
    join public.brands candidate on candidate.id = member_brand.brand_id
    where member_brand.network_id = selected_network_id
      and candidate.organization_kind = 'franchisor'
      and member_brand.status = 'active' order by member_brand.created_at limit 1;
    insert into public.franchise_network_brands (
      network_id, brand_id, added_by, status, accepted_by, accepted_at
    ) values (
      selected_network_id, created_brand_id, actor_id, 'pending', null, null
    );
    insert into public.franchise_agreements (
      network_id, franchisor_brand_id, franchisee_brand_id, status,
      territory, inheritance_policy, accepted_by, effective_at
    ) values (
      selected_network_id, franchisor_brand_id, created_brand_id, 'pending',
      coalesce(p_territory, '{}'::jsonb),
      coalesce(p_inheritance_policy, '{}'::jsonb), null, null
    );
  end if;
  insert into public.organization_readiness_checks (
    brand_id, check_key, required, status, evidence, checked_by, checked_at
  ) values
    (created_brand_id, 'database', true, 'passed', jsonb_build_object('migration', '20260904100345'), actor_id, now()),
    (created_brand_id, 'owner', true, 'passed', jsonb_build_object('userId', p_owner_user_id), actor_id, now()),
    (created_brand_id, 'modules', true, 'passed', jsonb_build_object(
      'count', jsonb_array_length(p_modules), 'surfaces', declared_surfaces
    ), actor_id, now()),
    (created_brand_id, 'location', requires_location,
      case when requires_location then 'passed' else 'pending' end,
      case when created_location_id is null then '{}'::jsonb
        else jsonb_build_object('locationId', created_location_id) end,
      case when requires_location then actor_id end,
      case when requires_location then now() end),
    (created_brand_id, 'tenant_artifacts', true, 'pending', '{}'::jsonb, null, null),
    (created_brand_id, 'release_approval', true, 'pending', '{}'::jsonb, null, null),
    (created_brand_id, 'payment_provider', requires_payment_provider, 'pending', '{}'::jsonb, null, null);
  update public.organization_provisioning_runs provisioning_run set
    stage = 'awaiting_external',
    request = request || jsonb_build_object(
      'locationId', created_location_id, 'networkId', selected_network_id,
      'moduleCount', jsonb_array_length(p_modules),
      'applicationSurfaces', declared_surfaces
    )
  where provisioning_run.id = run.id;
  insert into public.platform_access_events (
    actor_id, brand_id, location_id, action, correlation_id, metadata
  ) values (
    actor_id, created_brand_id, created_location_id, 'organizations.provision', p_idempotency_key,
    jsonb_build_object('network_id', selected_network_id,
      'organization_kind', p_organization_kind,
      'industry_key', p_industry_key, 'surface', 'hq')
  );
  return jsonb_build_object('brandId', created_brand_id, 'locationId', created_location_id,
    'networkId', selected_network_id, 'stage', 'awaiting_external', 'replayed', false);
end $$;
revoke all on function public.provision_platform_organization(
  uuid, text, text, uuid, text, text, text, text, jsonb, jsonb, jsonb,
  text, jsonb, jsonb, integer, integer, bigint
) from public, anon;
grant execute on function public.provision_platform_organization(
  uuid, text, text, uuid, text, text, text, text, jsonb, jsonb, jsonb,
  text, jsonb, jsonb, integer, integer, bigint
) to authenticated;

-- Service workers may complete an external check only with immutable evidence.
create or replace function public.record_organization_readiness(
  p_brand_id uuid,
  p_check_key text,
  p_passed boolean,
  p_evidence jsonb
) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if jsonb_typeof(p_evidence) is distinct from 'object'
     or octet_length(p_evidence::text) > 16384
     or (p_check_key = 'tenant_artifacts' and coalesce(p_evidence->>'artifactDigest', '')
       !~ '^sha256:[0-9a-f]{64}$')
     or (p_check_key = 'release_approval' and coalesce(p_evidence->>'commitSha', '')
       !~ '^[0-9a-f]{40}$')
     or (p_check_key = 'release_approval' and coalesce(p_evidence->>'artifactDigest', '')
       !~ '^sha256:[0-9a-f]{64}$')
     or (p_check_key = 'release_approval' and coalesce(p_evidence->>'providerReference', '')
       !~ '^[a-z][a-z0-9_-]{1,31}:[A-Za-z0-9][A-Za-z0-9._:/-]{2,255}$')
     or (p_check_key = 'payment_provider' and coalesce(p_evidence->>'providerReference', '')
       !~ '^[a-z][a-z0-9_-]{1,31}:[A-Za-z0-9][A-Za-z0-9._:/-]{2,255}$')
     or p_check_key not in ('tenant_artifacts', 'release_approval', 'payment_provider') then
    raise exception using errcode = '22023', message = 'immutable_readiness_evidence_required';
  end if;
  update public.organization_readiness_checks set
    status = case when p_passed then 'passed' else 'failed' end,
    evidence = p_evidence, checked_at = now(), checked_by = null
  where brand_id = p_brand_id and check_key = p_check_key;
  if not found then raise exception using errcode = '23503', message = 'readiness_check_not_found'; end if;
  if p_check_key = 'tenant_artifacts' and p_passed then
    update public.organization_readiness_checks approval set
      status = 'pending', evidence = '{}'::jsonb, checked_at = null, checked_by = null
    where approval.brand_id = p_brand_id
      and approval.check_key = 'release_approval'
      and approval.status = 'passed'
      and approval.evidence->>'artifactDigest' is distinct from p_evidence->>'artifactDigest';
  end if;
  update public.organization_provisioning_runs set stage = case
    when not exists (
      select 1 from public.organization_readiness_checks check_row
      where check_row.brand_id = p_brand_id and check_row.required
        and check_row.status <> 'passed'
    ) then 'ready' else 'awaiting_external' end
  where brand_id = p_brand_id;
  return true;
end $$;
revoke all on function public.record_organization_readiness(uuid, text, boolean, jsonb)
  from public, anon, authenticated;
grant execute on function public.record_organization_readiness(uuid, text, boolean, jsonb)
  to service_role;

create or replace function public.activate_platform_organization(p_brand_id uuid)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := (select auth.uid());
begin
  if actor_id is null or not app.is_platform_admin() then
    raise exception using errcode = '42501', message = 'platform_actor_required';
  end if;
  perform 1 from public.brands where id = p_brand_id and status = 'provisioning' for update;
  if not found then return false; end if;
  if not exists (
    select 1 from public.organization_provisioning_runs provisioning_run
    where provisioning_run.brand_id = p_brand_id and provisioning_run.stage = 'ready'
  ) or not coalesce((
    select array_agg(check_row.check_key) @> array[
      'database', 'owner', 'modules', 'location', 'tenant_artifacts',
      'release_approval', 'payment_provider'
    ]::text[]
    from public.organization_readiness_checks check_row
    where check_row.brand_id = p_brand_id
  ), false) or exists (
    select 1 from public.organization_readiness_checks check_row
    where check_row.brand_id = p_brand_id and check_row.required
      and check_row.status <> 'passed'
  ) or exists (
    select 1 from public.brands brand
    where brand.id = p_brand_id and brand.organization_kind = 'franchisee'
      and not exists (
        select 1
        from public.franchise_network_brands member_brand
        join public.franchise_agreements agreement
          on agreement.network_id = member_brand.network_id
          and agreement.franchisee_brand_id = member_brand.brand_id
        where member_brand.brand_id = p_brand_id
          and member_brand.status = 'active'
          and agreement.status = 'active'
      )
  ) or (
    select artifact.evidence->>'artifactDigest'
    from public.organization_readiness_checks artifact
    where artifact.brand_id = p_brand_id and artifact.check_key = 'tenant_artifacts'
  ) is distinct from (
    select approval.evidence->>'artifactDigest'
    from public.organization_readiness_checks approval
    where approval.brand_id = p_brand_id and approval.check_key = 'release_approval'
  ) then raise exception using errcode = '23514', message = 'organization_not_ready'; end if;
  update public.brands set status = 'active' where id = p_brand_id;
  update public.organization_provisioning_runs set stage = 'active' where brand_id = p_brand_id;
  insert into public.platform_access_events (
    actor_id, brand_id, location_id, action, correlation_id, metadata
  ) values (actor_id, p_brand_id, null, 'organizations.activate', gen_random_uuid(),
    jsonb_build_object('surface', 'hq'));
  return true;
end $$;
revoke all on function public.activate_platform_organization(uuid) from public, anon;
grant execute on function public.activate_platform_organization(uuid) to authenticated;

-- Network reporting must ignore unaccepted/revoked enrollment and every
-- non-active tenant, including provisioning and suspended brands. Keep the
-- service helper and caller facade on the same fail-closed rule.
create or replace function app.network_brand_kpis(
  p_network_id uuid,
  p_user_id uuid
) returns table (brand_id uuid, orders_30d integer, gross_cents_30d bigint)
language plpgsql stable security definer set search_path = '' as $$
declare is_member boolean;
begin
  is_member := exists (
    select 1 from public.franchise_memberships membership
    where membership.network_id = p_network_id and membership.user_id = p_user_id
  );
  if not is_member and not exists (
    select 1 from public.delegated_access_grants grant_row
    join public.franchise_network_brands member_brand
      on member_brand.network_id = grant_row.network_id
      and member_brand.brand_id = grant_row.brand_id
      and member_brand.status = 'active'
    join public.brands brand
      on brand.id = member_brand.brand_id and brand.status = 'active'
    where grant_row.network_id = p_network_id
      and grant_row.grantee_user_id = p_user_id
      and grant_row.revoked_at is null and grant_row.expires_at > now()
      and 'network:kpis' = any(grant_row.scope)
  ) then
    raise exception using errcode = 'P0002', message = 'network_access_denied';
  end if;
  return query
  select member_brand.brand_id, count(order_row.id)::integer,
    coalesce(sum(order_row.total_cents), 0)::bigint
  from public.franchise_network_brands member_brand
  join public.brands brand
    on brand.id = member_brand.brand_id and brand.status = 'active'
  left join public.orders order_row
    on order_row.brand_id = member_brand.brand_id
    and order_row.created_at >= now() - interval '30 days'
  where member_brand.network_id = p_network_id
    and member_brand.status = 'active'
    and (is_member or exists (
      select 1 from public.delegated_access_grants grant_row
      where grant_row.network_id = p_network_id
        and grant_row.brand_id = member_brand.brand_id
        and grant_row.grantee_user_id = p_user_id
        and grant_row.revoked_at is null and grant_row.expires_at > now()
        and 'network:kpis' = any(grant_row.scope)
    ))
  group by member_brand.brand_id;
end $$;
revoke all on function app.network_brand_kpis(uuid, uuid)
  from public, anon, authenticated;
grant execute on function app.network_brand_kpis(uuid, uuid) to service_role;

create or replace function public.caller_network_brand_kpis(p_network_id uuid)
returns table (brand_id uuid, brand_name text, orders_30d integer, gross_cents_30d bigint)
language plpgsql stable security definer set search_path = '' as $$
declare caller uuid := (select auth.uid());
declare is_member boolean;
begin
  if caller is null then raise exception using errcode = 'P0002', message = 'network_access_denied'; end if;
  is_member := exists (select 1 from public.franchise_memberships membership
    where membership.network_id = p_network_id and membership.user_id = caller);
  if not is_member and not exists (
    select 1 from public.delegated_access_grants grant_row
    join public.franchise_network_brands member_brand
      on member_brand.network_id = grant_row.network_id
      and member_brand.brand_id = grant_row.brand_id and member_brand.status = 'active'
    join public.brands brand on brand.id = member_brand.brand_id and brand.status = 'active'
    where grant_row.network_id = p_network_id and grant_row.grantee_user_id = caller
      and grant_row.revoked_at is null and grant_row.expires_at > now()
      and 'network:kpis' = any(grant_row.scope)
  ) then raise exception using errcode = 'P0002', message = 'network_access_denied'; end if;
  return query select member_brand.brand_id, brand.name,
    count(order_row.id)::integer, coalesce(sum(order_row.total_cents), 0)::bigint
  from public.franchise_network_brands member_brand
  join public.brands brand on brand.id = member_brand.brand_id and brand.status = 'active'
  left join public.orders order_row on order_row.brand_id = member_brand.brand_id
    and order_row.created_at >= now() - interval '30 days'
  where member_brand.network_id = p_network_id and member_brand.status = 'active'
    and (is_member or member_brand.brand_id in (
      select grant_row.brand_id from public.delegated_access_grants grant_row
      where grant_row.network_id = p_network_id and grant_row.grantee_user_id = caller
        and grant_row.revoked_at is null and grant_row.expires_at > now()
        and 'network:kpis' = any(grant_row.scope)
    )) group by member_brand.brand_id, brand.name;
end $$;
revoke all on function public.caller_network_brand_kpis(uuid) from public, anon, authenticated;
grant execute on function public.caller_network_brand_kpis(uuid) to authenticated, service_role;

-- Supersede earlier release assertions whose intended client entry points this
-- migration deliberately retires or replaces with idempotent variants.
create or replace function app.assert_argument_identity_writers_are_service_only()
returns void language plpgsql stable security invoker set search_path = '' as $$
declare
  guarded constant text[] := array[
    'public.manage_platform_brand_member(uuid,uuid,uuid,app.brand_role,uuid[],boolean,text,uuid)',
    'public.ensure_platform_brand_membership(uuid,uuid)',
    'public.record_platform_access(uuid,uuid,uuid,text,uuid,jsonb)',
    'public.set_platform_brand_settings_config(uuid,uuid,jsonb,uuid,timestamptz)',
    'public.set_platform_kiosk_config(uuid,uuid,jsonb,uuid,timestamptz)',
    'public.get_platform_fee_terms(uuid,uuid)',
    'public.set_platform_location_fee_overrides(uuid,uuid,uuid,uuid,integer,integer,bigint)',
    'public.import_platform_brand_menu(uuid,uuid,jsonb,uuid)'
  ];
  target text;
  client text;
begin
  foreach target in array guarded loop
    if pg_catalog.to_regprocedure(target) is null then
      raise exception 'argument-identity writer % is missing', target;
    end if;
    foreach client in array array['anon', 'authenticated'] loop
      if pg_catalog.has_function_privilege(client, target, 'execute') then
        raise exception 'argument-identity writer % is reachable by %', target, client;
      end if;
    end loop;
  end loop;
  if pg_catalog.has_function_privilege(
    'authenticated', 'public.create_platform_organization(text,text,jsonb,uuid)', 'execute'
  ) then raise exception 'legacy partial organization creation remains reachable'; end if;
  if not pg_catalog.has_function_privilege(
    'authenticated',
    'public.provision_platform_organization(uuid,text,text,uuid,text,text,text,text,jsonb,jsonb,jsonb,text,jsonb,jsonb,integer,integer,bigint)',
    'execute'
  ) then raise exception 'transactional organization provisioning is unreachable'; end if;
end $$;
revoke all on function app.assert_argument_identity_writers_are_service_only()
  from public, anon, authenticated;
grant execute on function app.assert_argument_identity_writers_are_service_only() to service_role;

create or replace function app.assert_franchise_network_write_path()
returns void language plpgsql stable security invoker set search_path = '' as $$
declare
  writers constant text[] := array[
    'public.create_franchise_network(text,text)',
    'public.enroll_brand_in_network(uuid,uuid)',
    'public.grant_delegated_access(uuid,uuid,uuid,text[],timestamptz,uuid)',
    'public.respond_to_network_enrollment(uuid,uuid,boolean)',
    'public.unenroll_brand_from_network(uuid,uuid)',
    'public.revoke_delegated_access(uuid)'
  ];
  target text;
begin
  foreach target in array writers loop
    if pg_catalog.to_regprocedure(target) is null then
      raise exception 'franchise network writer % is missing', target;
    end if;
    if pg_catalog.has_function_privilege('anon', target, 'execute') then
      raise exception 'franchise network writer % is reachable by anon', target;
    end if;
    if not pg_catalog.has_function_privilege('authenticated', target, 'execute') then
      raise exception 'franchise network writer % is unreachable by authenticated', target;
    end if;
    if pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(target))
       !~ 'actor_id uuid := \(select auth\.uid\(\)\)' then
      raise exception 'franchise network writer % does not resolve auth.uid()', target;
    end if;
    if pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(target))
       !~ 'SECURITY DEFINER' then
      raise exception 'franchise network writer % is no longer security definer', target;
    end if;
  end loop;
  if pg_catalog.has_function_privilege(
    'authenticated',
    'public.grant_delegated_access(uuid,uuid,uuid,text[],timestamptz)', 'execute'
  ) then raise exception 'non-idempotent delegated grant remains client reachable'; end if;
end $$;
revoke all on function app.assert_franchise_network_write_path()
  from public, anon, authenticated;
grant execute on function app.assert_franchise_network_write_path() to service_role;

create or replace function app.assert_franchise_provisioning_contract()
returns void language plpgsql stable security invoker set search_path = '' as $$
begin
  if pg_catalog.has_table_privilege('authenticated', 'public.brands', 'insert')
     or pg_catalog.has_table_privilege('authenticated', 'public.brands', 'delete') then
    raise exception 'authenticated retains direct brands create/delete';
  end if;
  if pg_catalog.to_regprocedure(
    'public.provision_platform_organization(uuid,text,text,uuid,text,text,text,text,jsonb,jsonb,jsonb,text,jsonb,jsonb,integer,integer,bigint)'
  ) is null then raise exception 'organization provisioning RPC is missing'; end if;
  if pg_catalog.has_function_privilege(
    'authenticated', 'public.record_organization_readiness(uuid,text,boolean,jsonb)', 'execute'
  ) then raise exception 'a browser can forge readiness evidence'; end if;
  if pg_catalog.has_function_privilege(
    'authenticated', 'public.install_brand_module(uuid,text,text,jsonb,text[])', 'execute'
  ) then raise exception 'a browser can forge module surface declarations'; end if;
  if pg_catalog.has_function_privilege(
    'authenticated', 'public.create_platform_organization(text,text,jsonb,uuid)', 'execute'
  ) then raise exception 'legacy partial organization creation remains callable'; end if;
  if pg_catalog.has_function_privilege(
    'authenticated',
    'public.grant_delegated_access(uuid,uuid,uuid,text[],timestamp with time zone)',
    'execute'
  ) then raise exception 'non-idempotent delegated grant overload remains callable'; end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'module_installation_events_installation_brand_fk'
  ) then raise exception 'module event tenant identity is not enforced'; end if;
  if exists (
    select 1 from public.module_installations installation
    join app.module_registry registry on registry.module_key = installation.module_key
    where not app.is_valid_application_surface_set(installation.surfaces)
      or not installation.surfaces <@ registry.surfaces
  ) then raise exception 'module installation surfaces exceed the registry'; end if;
  if not exists (
    select 1 from public.industry_blueprints blueprint
    where blueprint.industry_key = 'construction' and blueprint.version = 1
      and blueprint.status = 'active'
      and blueprint.manifest->'applicationSurfaces' = '["hq","display","customer","operator","kiosk"]'::jsonb
      and blueprint.manifest->'recommendedModules' = '["construction-projects","workforce-operations","workforce-training","commerce-catalog","commerce-ordering","commerce-payments","local-printing","device-wall"]'::jsonb
  ) then raise exception 'construction blueprint surface contract is missing'; end if;
end $$;
revoke all on function app.assert_franchise_provisioning_contract()
  from public, anon, authenticated;
grant execute on function app.assert_franchise_provisioning_contract() to service_role;

select app.register_release(
  '20260904100345',
  'franchise tenants provision transactionally, activate through evidenced readiness, and expose no direct brands DML',
  'app.assert_franchise_provisioning_contract()'::regprocedure
);
