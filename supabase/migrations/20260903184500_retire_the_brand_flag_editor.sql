-- Retire the last writer of brand_config.features.
--
-- 20260903170000 stripped the key from storage and from the storefront
-- projection, and deliberately left the two settings writers alone: both
-- RAISE on a section they do not recognise, so removing 'features' from their
-- allow-lists breaks the HQ editor's save on the commit that lands it. That
-- editor is deleted by the TypeScript half of this phase, which is this
-- commit, so the two changes ship together.
--
-- The order is not cosmetic. set_brand_settings_config merges with
--
--   jsonb_set(..., '{features}', coalesce(brand_config->'features','{}') || config->'features')
--
-- and there is no coalesce on the RIGHT operand. `jsonb || NULL` is NULL,
-- jsonb_set is strict, and brands.brand_config is NOT NULL -- so deleting
-- `features` from the client patch without touching this function would make
-- the whole chain evaluate to NULL and every save fail 23502 on the next
-- deploy. The platform variant (20260831171620) already coalesces both sides;
-- the home-tenant one (20260824070000) never got it. Both get it here, so a
-- future section that a client stops sending degrades to a no-op rather than
-- to a nulled column.
--
-- Also removed: the `features` leg itself and the key from both allow-lists.
-- A client that still sends the section now gets a clear rejection instead of
-- a silent write to a blob nothing reads.
--
-- Locks and volume. No DDL on any table: two CREATE OR REPLACE FUNCTIONs,
-- which take ACCESS EXCLUSIVE on pg_proc rows only, and one UPDATE over
-- public.brands taking ROW EXCLUSIVE for one row per brand -- four tenant
-- folders today, tens of rows on the largest deployment. Milliseconds.
--
-- The update fires brands_signal_brand_config_change once per brand that still
-- carries the key, so those kiosks refetch their config. Almost always zero
-- brands: 20260903170000 already stripped it, and this catches only a save
-- made in the window between the two deploys.

-- 1. The home-tenant writer ------------------------------------------------

-- Reproduced in full rather than patched. CREATE OR REPLACE FUNCTION resets
-- every attribute not restated, so `set search_path = ''` -- applied by
-- 20260824100000_release_security_hardening -- has to be written out here or
-- it silently reverts to the session default. Unqualified built-ins below
-- still resolve because pg_catalog is searched regardless of the setting.
create or replace function public.set_brand_settings_config(
  config jsonb,
  expected_updated_at timestamptz default null
)
returns timestamptz
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target public.brands%rowtype;
  allowed constant text[] := array['tokens', 'copy', 'board'];
begin
  if jsonb_typeof(config) is distinct from 'object'
     or exists (select 1 from jsonb_object_keys(config) as keys(key) where not key = any(allowed)) then
    raise exception 'brand settings contain an unsupported section';
  end if;
  if pg_column_size(config) > 16384 then
    raise exception 'brand_config_too_large';
  end if;
  if exists (
    select 1 from jsonb_each(config) section
    where jsonb_typeof(section.value) is distinct from 'object'
  ) then
    raise exception 'brand settings sections must be JSON objects';
  end if;

  select * into target from public.brands where id = app.jwt_brand_id();
  if not found then raise exception 'no brand in scope'; end if;
  if expected_updated_at is not null and target.updated_at is distinct from expected_updated_at then
    raise exception 'brand_config_stale';
  end if;

  update public.brands
  set brand_config = jsonb_set(
    jsonb_set(
      jsonb_set(
        brand_config,
        '{tokens}', coalesce(brand_config -> 'tokens', '{}'::jsonb)
          || coalesce(config -> 'tokens', '{}'::jsonb)
      ),
      '{copy}', coalesce(brand_config -> 'copy', '{}'::jsonb)
        || coalesce(config -> 'copy', '{}'::jsonb)
    ),
    '{board}', coalesce(brand_config -> 'board', '{}'::jsonb)
      || coalesce(config -> 'board', '{}'::jsonb)
  )
  where id = target.id
  returning updated_at into target.updated_at;
  return target.updated_at;
end $$;

revoke execute on function public.set_brand_settings_config(jsonb, timestamptz) from anon, public;
grant execute on function public.set_brand_settings_config(jsonb, timestamptz) to authenticated;

-- 2. The platform writer ---------------------------------------------------

-- Same change, one leg fewer. Everything else -- the platform audit, the
-- secret-shaped-key refusal, the row lock, the optimistic-concurrency check --
-- is reproduced exactly as 20260831171620 wrote it.
create or replace function public.set_platform_brand_settings_config(
  p_actor_id uuid,
  p_brand_id uuid,
  p_config jsonb,
  p_correlation_id uuid,
  p_expected_updated_at timestamptz default null
) returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.brands%rowtype;
  allowed constant text[] := array['tokens', 'copy', 'board'];
begin
  perform app.require_platform_audit(
    p_actor_id, p_brand_id, null, 'brand.settings.update', p_correlation_id
  );
  if jsonb_typeof(p_config) is distinct from 'object'
     or exists (select 1 from jsonb_object_keys(p_config) keys(key) where not key = any(allowed))
     or exists (select 1 from jsonb_each(p_config) section where jsonb_typeof(section.value) is distinct from 'object')
  then raise exception using errcode = '22023', message = 'invalid_brand_settings'; end if;
  if pg_column_size(p_config) > 16384 then
    raise exception using errcode = '22023', message = 'brand_config_too_large';
  end if;
  if p_config::text ~* '"[^"]*(passcode|secret|password|api_key|apikey|access_token|refresh_token)[^"]*"[[:space:]]*:' then
    raise exception using errcode = '22023', message = 'brand_config_contains_secret';
  end if;
  select * into target from public.brands where id = p_brand_id for update;
  if target.id is null then raise exception using errcode = '23503', message = 'platform_brand_not_found'; end if;
  if p_expected_updated_at is not null and target.updated_at is distinct from p_expected_updated_at then
    raise exception using errcode = '40001', message = 'brand_config_stale';
  end if;
  update public.brands set brand_config = jsonb_set(
    jsonb_set(jsonb_set(
      brand_config,
      '{tokens}', coalesce(brand_config -> 'tokens', '{}'::jsonb) || coalesce(p_config -> 'tokens', '{}'::jsonb)
    ), '{copy}', coalesce(brand_config -> 'copy', '{}'::jsonb) || coalesce(p_config -> 'copy', '{}'::jsonb)),
    '{board}', coalesce(brand_config -> 'board', '{}'::jsonb) || coalesce(p_config -> 'board', '{}'::jsonb)
  ) where id = p_brand_id returning updated_at into target.updated_at;
  return target.updated_at;
end $$;

revoke all on function public.set_platform_brand_settings_config(uuid, uuid, jsonb, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.set_platform_brand_settings_config(uuid, uuid, jsonb, uuid, timestamptz)
  to service_role;

-- 3. Sweep whatever the closing window let through -------------------------

update public.brands
   set brand_config = brand_config - 'features'
 where brand_config ? 'features';

-- Readiness ----------------------------------------------------------------

-- Catalog facts, not data. The absence of the key in brand_config is
-- deliberately NOT asserted: onboarding writes a brand row from the tenant's
-- own brand.json, which still carries a `features` block for the Expo bundles
-- to read at build time, so a release gate on the data would trip on a
-- legitimate `pnpm onboard` rather than on a regression. What must not come
-- back is a WRITER, and that is a function definition.
create or replace function app.assert_brand_flag_editor_retired()
returns void language plpgsql stable security invoker set search_path = '' as $$
declare
  home text;
  platform text;
begin
  home := pg_catalog.pg_get_functiondef(
    'public.set_brand_settings_config(jsonb, timestamptz)'::regprocedure);
  platform := pg_catalog.pg_get_functiondef(
    'public.set_platform_brand_settings_config(uuid, uuid, jsonb, uuid, timestamptz)'::regprocedure);

  if home ~ '''features''' or platform ~ '''features''' then
    raise exception 'a brand settings writer accepts the features section again';
  end if;

  -- The nulling hazard the section removal exposed: an uncoalesced right
  -- operand makes `jsonb_set` strict on a section the client stopped sending,
  -- and brands.brand_config is NOT NULL.
  if home ~ '\|\| config -> ''[a-z]+'''
     or platform ~ '\|\| p_config -> ''[a-z]+''' then
    raise exception 'a brand settings merge lost its right-side coalesce';
  end if;

  -- The storefront must still be withholding the stripped key.
  if pg_catalog.pg_get_functiondef('app.brand_storefront_rows(text, uuid)'::regprocedure)
     !~ 'brand_config - ''features''' then
    raise exception 'the storefront projects brand_config.features again';
  end if;
end $$;

revoke all on function app.assert_brand_flag_editor_retired()
  from public, anon, authenticated;
grant execute on function app.assert_brand_flag_editor_retired() to service_role;

select app.register_release(
  '20260903184500',
  'the HQ brand flag editor is retired: neither settings writer accepts a features section, and every remaining merge coalesces both operands',
  'app.assert_brand_flag_editor_retired()'::regprocedure
);
