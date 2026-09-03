-- Phase 2.6a: make module_installations safe to be the authorization root.
--
-- The resolver that replaces the legacy brand flags will read this table to
-- decide what a tenant may do. Three things have to be true before a table can
-- carry that weight, and none of them is true today.
--
-- 1. A logged-out customer has to be able to resolve capability, and cannot:
--    module_installations_select requires app.is_brand_staff. The projection
--    below is the anon path, modelled on the narrowing 20260903005237 applied
--    to the storefront -- the identifier is an argument, the predicate is in
--    the body, and naming nothing returns nothing. It returns two columns and
--    only two: the tenant's public slug and a module key. Everything else the
--    table carries is withheld deliberately. `config` is arbitrary tenant JSON;
--    `config_revision` leaks change cadence; `state` distinguishes 'error' and
--    'suspended', which is operational health; `installed_by` is a live
--    auth.users id and so an account-enumeration oracle; the timestamps date
--    every tenant's rollout. site_module_overrides and delegated_access_grants
--    never appear on this path at all.
--
-- 2. Only app.set_module_installation_state may move an installation through
--    its lifecycle -- 20260902083817 says so in a comment and nothing enforced
--    it. `grant all ... to service_role` let any holder of the service key
--    `insert ... state = 'active'` directly, skipping the optimistic-concurrency
--    check and leaving module_installation_events with no record that a
--    capability was granted. The append-only guard protects that table from
--    being rewritten; it never stopped a writer from not writing to it.
--
-- 3. `module_key` was constrained only by a slug regex, so a typo or an
--    injected value could name a capability no registry entry governs. Once
--    installations are authoritative, an ungoverned key is an ungoverned
--    permission set.
--
-- Locks and volume. Every table touched here holds tens of rows on the largest
-- deployment: one installation per (brand, module), one brands row per tenant,
-- four tenant folders today. Adding the foreign key takes ACCESS EXCLUSIVE on
-- public.module_installations for a validating scan of that table; the
-- brand_config strip takes ROW EXCLUSIVE on public.brands for one update per
-- brand. Both are milliseconds. The indexes are built without CONCURRENTLY
-- deliberately: CREATE INDEX CONCURRENTLY cannot run inside the transaction a
-- migration is applied in, and a non-concurrent build over a table this size
-- finishes faster than the lock wait would.
--
-- The brand_config strip fires brands_signal_brand_config_change once per
-- brand, so every kiosk refetches its config. That is the trigger doing its
-- job: the config really did change.

-- 1. The registry, in SQL -------------------------------------------------

-- MODULE_REGISTRY lives in TypeScript, which the database cannot read, and a
-- CHECK constraint listing keys inline would have to be dropped and recreated
-- for every module the platform ships. A seeded reference table is the honest
-- middle: the database gets a real referential constraint, the registry stays
-- authored in one place, and packages/module-kit/src/registry-sql.test.ts
-- fails the build if the seed here and MODULE_REGISTRY ever disagree -- on
-- keys or on surfaces.
--
-- `surfaces` is carried because the anon projection needs it. Without it the
-- allow-list would have to be a literal list of keys inside the projection
-- function, which is the same drift problem one indirection further away.
create table app.module_registry (
  module_key text primary key
    constraint module_registry_key_is_slug_shaped
    check (module_key ~ '^[a-z][a-z0-9-]{1,48}[a-z0-9]$'),
  -- Mirrors ModuleDefinition.surfaces. The subset check is against
  -- APP_SURFACES; a surface this platform does not have cannot be seeded, so a
  -- typo cannot silently widen or narrow what anon sees.
  surfaces text[] not null
    constraint module_registry_surfaces_are_known
    check (
      cardinality(surfaces) between 1 and 5
      and surfaces <@ array['customer', 'kiosk', 'operator', 'display', 'hq']::text[]
    )
);

comment on table app.module_registry is
  'The SQL mirror of MODULE_REGISTRY (packages/module-kit/src/registry.ts). '
  'Referenced by module_installations.module_key and read by the anonymous '
  'capability projection; kept honest by registry-sql.test.ts.';

-- Not exposed to PostgREST and not readable by any client role. The definer
-- functions below reach it, and a foreign-key check runs as the constraint
-- owner, so neither needs a grant.
revoke all on table app.module_registry from public, anon, authenticated, service_role;
grant select on table app.module_registry to service_role;

insert into app.module_registry (module_key, surfaces) values
  ('commerce-catalog', array['customer', 'kiosk', 'operator', 'hq']),
  ('commerce-ordering', array['customer', 'kiosk', 'operator', 'display', 'hq']),
  ('commerce-payments', array['customer', 'kiosk', 'operator', 'hq']),
  ('commerce-catering', array['customer', 'operator', 'hq']),
  ('commerce-delivery', array['customer', 'operator', 'hq']),
  ('growth-loyalty', array['customer', 'kiosk', 'operator', 'hq']),
  ('growth-stored-value', array['customer', 'kiosk', 'operator', 'hq']),
  ('growth-referrals', array['customer', 'hq']),
  ('growth-drops', array['customer', 'kiosk', 'operator', 'hq']),
  ('workforce-operations', array['operator', 'hq']),
  ('workforce-training', array['operator', 'hq']),
  ('local-printing', array['kiosk', 'operator', 'hq']),
  ('construction-projects', array['operator', 'hq']),
  ('device-wall', array['operator', 'kiosk', 'display']);

-- Fail with the offending keys named rather than with a bare 23503 from the
-- constraint below. An unregistered key is exactly what this migration exists
-- to make impossible, so the deploy stopping here is the correct outcome --
-- but whoever is paged should not have to go find which key it was.
do $$
declare
  offending text;
begin
  select string_agg(distinct installation.module_key, ', ' order by installation.module_key)
    into offending
    from public.module_installations installation
    left join app.module_registry registry
      on registry.module_key = installation.module_key
   where registry.module_key is null;
  if offending is not null then
    raise exception 'module_installations carry keys no registry entry governs: %', offending;
  end if;
end $$;

-- restrict rather than cascade in both directions. A module key is documented
-- as stable across versions, so an ON UPDATE CASCADE would exist only to make
-- a rename easy -- and it would rewrite module_installations from inside a
-- referential trigger, which the write guard below refuses on purpose.
alter table public.module_installations
  add constraint module_installations_module_key_in_registry
  foreign key (module_key) references app.module_registry (module_key)
  on update restrict on delete restrict;

-- 2. Close the direct write path -----------------------------------------

-- The decision is platform_admin only: clients keep SELECT, and every install
-- or lifecycle move goes through a guarded writer. TRUNCATE goes with the
-- three DML privileges -- it is a write that skips row triggers entirely, so
-- leaving it would leave the guard below trivially bypassable.
revoke insert, update, delete, truncate on public.module_installations from service_role;

-- The second lock. The revoke is the boundary; this catches the writer that
-- gets the privilege back -- a future `grant all`, a migration doing a
-- convenience update, an admin at a psql prompt -- because a row trigger fires
-- for the table owner too.
--
-- It cannot be made unspoofable: anything able to run `insert` can also run
-- `set_config`. That is not the threat. The threat is a writer that skips the
-- audit trail without meaning to, and a latch nobody sets by accident answers
-- exactly that.
--
-- Deliberately unlike app.reject_module_installation_event_mutation: that guard
-- admits pg_trigger_depth() > 1 so a referential cascade can clean history up.
-- Here a nested write is not a cascade -- nothing cascades *into* this table --
-- so admitting depth would only open the door to a trigger on another table.
create or replace function app.reject_unguarded_module_installation_write() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if pg_catalog.current_setting('app.module_installation_writer', true) = 'guarded' then
    return new;
  end if;
  raise exception using errcode = '55000', message = 'module_installation_guarded_writer_only';
end $$;

revoke all on function app.reject_unguarded_module_installation_write()
  from public, anon, authenticated;

-- Fires before module_installations_touch, which is what the names buy: the
-- guard rejects before anything else has a chance to observe the row.
create trigger module_installations_guarded_writes
  before insert or update on public.module_installations
  for each row execute function app.reject_unguarded_module_installation_write();

-- set_module_installation_state has no insert path -- it only moves a row that
-- already exists -- so revoking insert without this would leave the table
-- unable to accept a first installation from anyone, ever. `state` is not a
-- parameter: an installation starts in 'draft' and reaches 'active' only
-- through the lifecycle writer, which is the whole point of closing the direct
-- path. The latch is cleared immediately after the insert so the rest of the
-- transaction is guarded again; a raise inside the insert rolls the setting
-- back with the subtransaction.
create or replace function app.create_module_installation(
  p_brand_id uuid,
  p_module_key text,
  p_version text,
  p_config jsonb,
  p_actor uuid,
  p_correlation_id uuid
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  installation_id uuid;
begin
  if p_config is not null
     and (jsonb_typeof(p_config) is distinct from 'object'
          or octet_length(p_config::text) > 16384) then
    raise exception using errcode = '22023', message = 'invalid_module_config';
  end if;

  perform pg_catalog.set_config('app.module_installation_writer', 'guarded', true);
  insert into public.module_installations (brand_id, module_key, version, config, installed_by)
  values (p_brand_id, p_module_key, p_version, coalesce(p_config, '{}'::jsonb), p_actor)
  returning id into installation_id;
  perform pg_catalog.set_config('app.module_installation_writer', '', true);

  insert into public.module_installation_events (
    installation_id, brand_id, event, from_state, to_state,
    config_revision, actor, detail
  ) values (
    installation_id, p_brand_id, 'installed', null, 'draft', 1, p_actor,
    jsonb_build_object('correlation_id', p_correlation_id)
  );
  return installation_id;
end $$;

revoke all on function app.create_module_installation(uuid, text, text, jsonb, uuid, uuid)
  from public, anon, authenticated;
grant execute on function app.create_module_installation(uuid, text, text, jsonb, uuid, uuid)
  to service_role;

-- Unchanged except for the latch around its update. Reproduced in full rather
-- than patched, because a CREATE OR REPLACE that drops a branch by accident is
-- how a state machine loses a transition.
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
  perform pg_catalog.set_config('app.module_installation_writer', 'guarded', true);
  update public.module_installations target set
    state = p_to_state,
    config = coalesce(p_config, target.config),
    config_revision = next_revision
  where target.id = installation.id;
  perform pg_catalog.set_config('app.module_installation_writer', '', true);

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

-- 3. The anonymous capability projection ----------------------------------

-- Customer-facing only, and that is narrower than "customer- and kiosk-facing"
-- on purpose. Two modules declare `kiosk` without declaring `customer`:
-- local-printing and device-wall. Projecting those to anon would publish which
-- tenants run a device wall and which have certified LAN printers -- exactly
-- the operational disclosure this filter exists to prevent, and one the legacy
-- flags never made: every boolean the storefront publishes today (drops,
-- catering, delivery, stored_value, referrals) is customer-facing, and
-- `operations` is already withheld. A kiosk is not an anonymous reader for
-- long -- it pairs, and a paired device has an identity a device-scoped reader
-- can authorize against. An anonymous one has no claim on hardware facts.
--
-- The result is two columns because two columns are all a capability decision
-- needs. Adding a third later is a decision, not an oversight, and the
-- assertion below states the shape so that decision cannot be made silently.
create or replace function app.brand_storefront_capability_rows(p_slug text)
returns table (slug text, module_key text)
language sql
stable
security definer
set search_path = ''
as $$
  select brand.slug, installation.module_key
    from public.brands brand
    join public.module_installations installation
      on installation.brand_id = brand.id
    join app.module_registry registry
      on registry.module_key = installation.module_key
   where p_slug is not null
     and brand.slug = p_slug
     and installation.state = 'active'
     and 'customer' = any (registry.surfaces)
$$;

revoke execute on function app.brand_storefront_capability_rows(text) from public;
grant execute on function app.brand_storefront_capability_rows(text)
  to anon, authenticated, service_role;

-- The public entry point, security invoker for the same reason
-- brand_storefront_lookup is: the narrowing lives in the definer it delegates
-- to, and this wrapper adds no privilege of its own.
create or replace function public.brand_storefront_capabilities(p_slug text default null)
returns table (slug text, module_key text)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from app.brand_storefront_capability_rows(p_slug)
$$;

revoke execute on function public.brand_storefront_capabilities(text) from public;
grant execute on function public.brand_storefront_capabilities(text)
  to anon, authenticated, service_role;

comment on function public.brand_storefront_capabilities(text) is
  'The anonymous capability read. Returns (slug, module_key) for the active, '
  'customer-facing installations of the one brand named by slug; naming '
  'nothing returns nothing. Never returns config, state, installed_by or any '
  'timestamp, and never touches site_module_overrides or delegated grants.';

-- 4. Indexes ---------------------------------------------------------------

-- Per-brand lookup already rides `unique (brand_id, module_key)`. These two do
-- not exist: 20260902124238 added module_installations (installed_by),
-- module_installation_events (installation_id, created_at desc) and
-- (actor), which is FK coverage and nothing else.

-- "Which tenants run module X", which is how backfill parity is checked and
-- how a franchisor answers the same question across a network.
create index if not exists module_installations_active_module_idx
  on public.module_installations (module_key, state) where state = 'active';

-- module_installation_events_select filters brand_id (20260902083817:224) and
-- the table is append-only and unbounded, so every brand-scoped audit read was
-- a sequential scan that grows for as long as the platform runs.
create index if not exists module_installation_events_brand_created_idx
  on public.module_installation_events (brand_id, created_at desc);

-- No retention sweep, and that is a decision rather than an omission. Deleting
-- from module_installation_events means weakening
-- app.reject_module_installation_event_mutation, which is the guarantee this
-- migration is otherwise strengthening -- an audit trail that a scheduled job
-- may prune is one an attacker with the same key may prune. The cost that
-- prompted the question was read cost, and the index above is what pays it.
-- If row count ever becomes the problem, the answer is to move history to a
-- separate archive with its own guard, not to hand this table a DELETE path.

-- 5. Strip the stale flag blob --------------------------------------------

-- brand_config.features is written by the HQ brand-settings editor and gates
-- nothing: every runtime read of a feature flag is either the boolean columns
-- on public.brands or the bundled tenant brand.json that the Expo apps compile
-- in (apps/*/src/tenant/brand.json). The only code that reads this key out of
-- the database is brandEditorStateOf (apps/hq/lib/brand-config.ts), to
-- populate the checkboxes of the editor that writes it -- a closed loop that
-- the next PR deletes.
--
-- Left in place it would outlive that deletion: anon reads brand_config in
-- full through the storefront, so every brand's last-written flag object would
-- stay publicly readable forever, contradicting module_installations with no
-- way for anyone to correct it. Stripped now, while the editor still exists,
-- the worst case is that someone reopens the editor and saves a fresh copy --
-- which is why the projection stops publishing the key as well, and why the
-- assertion below is stated against the projection rather than against the
-- data the editor can still write.
--
-- Deliberately NOT done here: removing 'features' from the allowed sections of
-- set_brand_settings_config / set_platform_brand_settings_config. Both reject
-- an unknown section outright, so that change breaks the editor's save on the
-- commit that lands it, and the editor is deleted by the TypeScript half of
-- this phase. It belongs in the same commit as its caller.
update public.brands
   set brand_config = brand_config - 'features'
 where brand_config ? 'features';

-- Reproduced whole from 20260903005237 with one change: brand_config is
-- projected minus 'features'. The narrowing that migration added -- identifier
-- as a required argument, at most one row, nothing for a caller that names
-- neither -- is unchanged and must stay that way; its own readiness assertions
-- still check the overloads and the dropped view.
create or replace function app.brand_storefront_rows(
  p_slug text,
  p_brand_id uuid
)
returns table (
  id uuid,
  slug text,
  name text,
  drops boolean,
  catering boolean,
  delivery boolean,
  multi_location boolean,
  sms boolean,
  stored_value boolean,
  referrals boolean,
  brand_config jsonb
)
language sql stable security definer
set search_path = ''
as $$
  select brand.id, brand.slug, brand.name, brand.drops, brand.catering,
         brand.delivery, brand.multi_location, brand.sms,
         brand.stored_value, brand.referrals, brand.brand_config - 'features'
    from public.brands brand
   where (p_slug is not null and brand.slug = p_slug)
      or (p_brand_id is not null and brand.id = p_brand_id)
   limit 1
$$;
revoke execute on function app.brand_storefront_rows(text, uuid) from public;
grant execute on function app.brand_storefront_rows(text, uuid)
  to anon, authenticated, service_role;

-- Readiness ----------------------------------------------------------------

-- Stated against the catalog wherever a catalog fact will do, so a later
-- migration cannot undo any of this quietly. The one thing not asserted is the
-- absence of brand_config.features in the data: the editor that writes it is
-- still shipped, and a release gate that a legitimate save can trip is a gate
-- someone disables.
create or replace function app.assert_module_installation_authority()
returns void language plpgsql stable security invoker set search_path = '' as $$
declare
  projection text;
begin
  if pg_catalog.to_regclass('app.module_registry') is null
     or not exists (select 1 from app.module_registry) then
    raise exception 'the SQL module registry is missing or empty';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'module_installations_module_key_in_registry'
      and conrelid = 'public.module_installations'::regclass
      and contype = 'f'
  ) then raise exception 'module_key is no longer constrained to the registry'; end if;

  -- The boundary. Any one of these four privileges reopens the direct write
  -- path the guarded writers exist to replace.
  if pg_catalog.has_table_privilege('service_role', 'public.module_installations', 'INSERT')
     or pg_catalog.has_table_privilege('service_role', 'public.module_installations', 'UPDATE')
     or pg_catalog.has_table_privilege('service_role', 'public.module_installations', 'DELETE')
     or pg_catalog.has_table_privilege('service_role', 'public.module_installations', 'TRUNCATE')
  then raise exception 'service_role can write module_installations directly again'; end if;
  if not pg_catalog.has_table_privilege('service_role', 'public.module_installations', 'SELECT') then
    raise exception 'the engine lost its read of module_installations';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_trigger
    where tgrelid = 'public.module_installations'::regclass
      and tgname = 'module_installations_guarded_writes'
      and not tgisinternal
  ) then raise exception 'the module installation write guard is missing'; end if;
  if pg_catalog.to_regprocedure(
       'app.create_module_installation(uuid, text, text, jsonb, uuid, uuid)') is null
     or pg_catalog.to_regprocedure(
       'app.set_module_installation_state(uuid, uuid, text, jsonb, integer, uuid, uuid)') is null
  then raise exception 'a guarded module installation writer is missing'; end if;

  -- The anon projection: it exists, anon may call it, and it still returns two
  -- columns. A third column is how a leak of config or state would arrive.
  if pg_catalog.to_regprocedure('public.brand_storefront_capabilities(text)') is null then
    raise exception 'the anonymous capability projection is missing';
  end if;
  if not pg_catalog.has_function_privilege(
       'anon', 'public.brand_storefront_capabilities(text)', 'EXECUTE') then
    raise exception 'anon cannot resolve capability';
  end if;
  if pg_catalog.pg_get_function_result(
       'public.brand_storefront_capabilities(text)'::regprocedure)
     is distinct from 'TABLE(slug text, module_key text)'
     or pg_catalog.pg_get_function_result(
       'app.brand_storefront_capability_rows(text)'::regprocedure)
     is distinct from 'TABLE(slug text, module_key text)'
  then raise exception 'the capability projection returns more than (slug, module_key)'; end if;
  if pg_catalog.has_table_privilege('anon', 'public.module_installations', 'SELECT') then
    raise exception 'anon reads module_installations directly';
  end if;

  projection := pg_catalog.pg_get_functiondef(
    'app.brand_storefront_capability_rows(text)'::regprocedure);
  if projection !~ 'customer'' = any \(registry\.surfaces\)'
     or projection !~ 'installation\.state = ''active''' then
    raise exception 'the capability projection lost its surface or state filter';
  end if;

  -- The storefront stops republishing the flag blob every save would otherwise
  -- restore.
  if pg_catalog.pg_get_functiondef('app.brand_storefront_rows(text, uuid)'::regprocedure)
     !~ 'brand_config - ''features''' then
    raise exception 'the storefront projects brand_config.features again';
  end if;

  if pg_catalog.to_regclass('public.module_installations_active_module_idx') is null
     or pg_catalog.to_regclass('public.module_installation_events_brand_created_idx') is null then
    raise exception 'a module installation index is missing';
  end if;
end $$;

revoke all on function app.assert_module_installation_authority()
  from public, anon, authenticated;
grant execute on function app.assert_module_installation_authority() to service_role;

select app.register_release(
  '20260903170000',
  'module_installations becomes the authorization root: an anon-safe (slug, module_key) projection, a registry-constrained key, and writes that only the guarded writers can make',
  'app.assert_module_installation_authority()'::regprocedure
);
