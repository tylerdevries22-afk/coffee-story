-- Franchise administration hardening.
--
-- Trusted writers may bypass RLS, so the database still enforces the two
-- invariants no application bug may weaken:
--   1. every staff location scope belongs to the membership's brand;
--   2. every platform access event names a real platform administrator and a
--      location inside the target brand.

create or replace function app.validate_brand_user_locations()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1
    from unnest(new.location_ids) as scoped(location_id)
    left join public.locations location
      on location.id = scoped.location_id
     and location.brand_id = new.brand_id
    where location.id is null
  ) then
    raise exception using
      errcode = '23514',
      message = 'staff_location_scope_outside_brand';
  end if;
  return new;
end $$;

revoke all on function app.validate_brand_user_locations()
  from public, anon, authenticated;

drop trigger if exists brand_users_validate_locations on public.brand_users;
create trigger brand_users_validate_locations
before insert or update of brand_id, location_ids on public.brand_users
for each row execute function app.validate_brand_user_locations();

-- Serialize every membership change on its brand. The shared private helper
-- protects platform operators, validates the final-owner invariant for both
-- deletion and demotion, and closes the two-owner concurrent removal race.
create or replace function app.apply_brand_member_change(
  p_brand_id uuid,
  p_user_id uuid,
  p_role app.brand_role,
  p_location_ids uuid[] default '{}'::uuid[],
  p_remove boolean default false
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing public.brand_users;
  result_id uuid;
begin
  if p_role = 'platform_admin' then
    raise exception using errcode = '42501', message = 'platform_role_not_assignable';
  end if;
  perform 1 from public.brands brand where brand.id = p_brand_id for update;
  if not found then
    raise exception using errcode = '23503', message = 'brand_not_found';
  end if;
  if exists (
    select 1 from public.brand_users member
    where member.user_id = p_user_id and member.role = 'platform_admin'
  ) then
    raise exception using errcode = '42501', message = 'platform_member_immutable';
  end if;

  select * into existing
  from public.brand_users member
  where member.brand_id = p_brand_id and member.user_id = p_user_id
  for update;

  if p_remove then
    if existing.id is null then return null; end if;
  end if;
  if existing.role = 'brand_owner'
     and (p_remove or p_role <> 'brand_owner')
     and not exists (
       select 1 from public.brand_users owner
       where owner.brand_id = p_brand_id
         and owner.role = 'brand_owner'
         and owner.id <> existing.id
     ) then
    raise exception using errcode = '23514', message = 'last_brand_owner_required';
  end if;
  if p_remove then
    delete from public.brand_users where id = existing.id;
    return existing.id;
  end if;

  if p_role in ('location_manager', 'staff')
     and cardinality(coalesce(p_location_ids, '{}'::uuid[])) = 0 then
    raise exception using errcode = '23514', message = 'staff_location_required';
  end if;

  insert into public.brand_users (user_id, brand_id, role, location_ids)
  values (
    p_user_id,
    p_brand_id,
    p_role,
    case when p_role = 'brand_owner' then '{}'::uuid[]
         else coalesce(p_location_ids, '{}'::uuid[]) end
  )
  on conflict (user_id, brand_id) do update set
    role = excluded.role,
    location_ids = excluded.location_ids
  returning id into result_id;
  return result_id;
end $$;

revoke all on function app.apply_brand_member_change(uuid, uuid, app.brand_role, uuid[], boolean)
  from public, anon, authenticated, service_role;

-- Home-tenant changes run as the signed-in brand owner. A platform admin is
-- deliberately rejected here so a direct authenticated RPC cannot bypass the
-- operate-as-brand audit path below.
create or replace function public.manage_brand_member(
  p_brand_id uuid,
  p_user_id uuid,
  p_role app.brand_role,
  p_location_ids uuid[] default '{}'::uuid[],
  p_remove boolean default false
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null
     or app.jwt_role() is distinct from 'brand_owner'
     or app.jwt_brand_id() is distinct from p_brand_id
     or not exists (
       select 1 from public.brand_users member
       where member.user_id = auth.uid()
         and member.brand_id = p_brand_id
         and member.role = 'brand_owner'
     ) then
    raise exception using errcode = '42501', message = 'brand_owner_required';
  end if;
  return app.apply_brand_member_change(
    p_brand_id, p_user_id, p_role, p_location_ids, p_remove
  );
end $$;

revoke all on function public.manage_brand_member(uuid, uuid, app.brand_role, uuid[], boolean)
  from public, anon;
grant execute on function public.manage_brand_member(uuid, uuid, app.brand_role, uuid[], boolean)
  to authenticated;

-- Bind every trusted cross-tenant write to a current platform administrator
-- membership and the exact immutable audit event emitted for that action.
create or replace function app.require_platform_audit(
  p_actor_id uuid,
  p_brand_id uuid,
  p_location_id uuid,
  p_action text,
  p_correlation_id uuid
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.brand_users member
    where member.user_id = p_actor_id and member.role = 'platform_admin'
  ) then
    raise exception using errcode = '42501', message = 'platform_actor_required';
  end if;
  if not exists (
    select 1 from public.platform_access_events event
    where event.actor_id = p_actor_id
      and event.brand_id = p_brand_id
      and event.location_id is not distinct from p_location_id
      and event.action = p_action
      and event.correlation_id = p_correlation_id
  ) then
    raise exception using errcode = '42501', message = 'platform_audit_required';
  end if;
end $$;

revoke all on function app.require_platform_audit(uuid, uuid, uuid, text, uuid)
  from public, anon, authenticated, service_role;

-- Cross-tenant staff changes are service-only and must name the exact audit
-- event written by authorizeWorkspaceMutation immediately before this call.
create or replace function public.manage_platform_brand_member(
  p_actor_id uuid,
  p_brand_id uuid,
  p_user_id uuid,
  p_role app.brand_role,
  p_location_ids uuid[],
  p_remove boolean,
  p_action text,
  p_correlation_id uuid
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_action not in ('staff.invite', 'staff.update', 'staff.remove')
     or (p_remove and p_action <> 'staff.remove')
     or (not p_remove and p_action = 'staff.remove') then
    raise exception using errcode = '22023', message = 'invalid_staff_action';
  end if;
  perform app.require_platform_audit(
    p_actor_id, p_brand_id, null, p_action, p_correlation_id
  );
  return app.apply_brand_member_change(
    p_brand_id, p_user_id, p_role, p_location_ids, p_remove
  );
end $$;

revoke all on function public.manage_platform_brand_member(
  uuid, uuid, uuid, app.brand_role, uuid[], boolean, text, uuid
) from public, anon, authenticated;
grant execute on function public.manage_platform_brand_member(
  uuid, uuid, uuid, app.brand_role, uuid[], boolean, text, uuid
) to service_role;

-- Membership writes must pass through one of the two invariant-preserving
-- RPCs above. Legacy RLS policies remain useful documentation and defense in
-- depth, but table privileges no longer let an authenticated caller bypass the
-- brand lock, platform-member protection, last-owner check, or support audit.
revoke insert, update, delete on table public.brand_users
  from anon, authenticated;

-- Cross-tenant authoring rows reference (brand_user_id, brand_id). A platform
-- operator therefore needs a real, attributable membership in each brand they
-- operate as. The service role may create that row only for an actor already
-- proven to hold platform_admin somewhere; it cannot elevate an ordinary user.
create or replace function public.ensure_platform_brand_membership(
  p_actor_id uuid,
  p_brand_id uuid
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare result_id uuid;
begin
  if not exists (
    select 1 from public.brand_users member
    where member.user_id = p_actor_id and member.role = 'platform_admin'
  ) then
    raise exception using errcode = '42501', message = 'platform_actor_required';
  end if;
  if not exists (select 1 from public.brands brand where brand.id = p_brand_id) then
    raise exception using errcode = '23503', message = 'platform_brand_not_found';
  end if;
  -- 20260824072313 deliberately makes protect_platform_admin_grant accept
  -- service-role writes (its app JWT role is null). Execution is still limited
  -- here: this RPC is service-only and verifies that the named actor already
  -- holds a platform_admin membership before this trigger-visible write. An
  -- existing target-brand membership is already attributable and is preserved;
  -- support setup must never demote an owner or erase a manager's scope.
  insert into public.brand_users (user_id, brand_id, role, location_ids)
  values (p_actor_id, p_brand_id, 'platform_admin', '{}'::uuid[])
  on conflict (user_id, brand_id) do nothing
  returning id into result_id;
  if result_id is null then
    select member.id into result_id from public.brand_users member
    where member.user_id = p_actor_id and member.brand_id = p_brand_id;
  end if;
  return result_id;
end $$;

revoke all on function public.ensure_platform_brand_membership(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.ensure_platform_brand_membership(uuid, uuid)
  to service_role;

-- Tenant creation remains a platform-administrator responsibility. Keep the
-- brand, creator membership, and immutable access event in one transaction so
-- no partially provisioned tenant can escape if any invariant fails.
create or replace function public.create_platform_organization(
  p_name text,
  p_slug text,
  p_brand_config jsonb,
  p_correlation_id uuid
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  brand_id uuid;
begin
  if actor_id is null or not exists (
    select 1 from public.brand_users member
    where member.user_id = actor_id and member.role = 'platform_admin'
  ) then
    raise exception using errcode = '42501', message = 'platform_actor_required';
  end if;
  if length(btrim(p_name)) not between 2 and 120
     or p_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
     or length(p_slug) > 63
     or jsonb_typeof(p_brand_config) is distinct from 'object'
     or pg_column_size(p_brand_config) > 16384
     or p_brand_config::text ~* '"[^"]*(passcode|secret|password|api_key|apikey|access_token|refresh_token)[^"]*"[[:space:]]*:' then
    raise exception using errcode = '22023', message = 'invalid_organization';
  end if;

  insert into public.brands (
    name, slug, drops, catering, delivery, multi_location, sms,
    stored_value, referrals, brand_config
  ) values (
    btrim(p_name), p_slug, false, false, false, true, false,
    false, false, p_brand_config
  ) returning id into brand_id;

  insert into public.brand_users (user_id, brand_id, role, location_ids)
  values (actor_id, brand_id, 'platform_admin', '{}'::uuid[]);
  insert into public.platform_access_events (
    actor_id, brand_id, location_id, action, correlation_id, metadata
  ) values (
    actor_id, brand_id, null, 'organizations.create', p_correlation_id,
    jsonb_build_object('source', 'organization_wizard', 'surface', 'hq')
  );
  return brand_id;
end $$;

revoke all on function public.create_platform_organization(text, text, jsonb, uuid)
  from public, anon;
grant execute on function public.create_platform_organization(text, text, jsonb, uuid)
  to authenticated;

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
  if p_action !~ '^[a-z][a-z0-9_.]{2,95}$' then
    raise exception using errcode = '22023', message = 'invalid_platform_action';
  end if;
  if jsonb_typeof(coalesce(p_metadata, '{}'::jsonb)) is distinct from 'object'
     or pg_column_size(coalesce(p_metadata, '{}'::jsonb)) > 8192
     or coalesce(p_metadata, '{}'::jsonb)::text
       ~* '"[^"]*(passcode|secret|password|api_key|apikey|access_token|refresh_token)[^"]*"[[:space:]]*:' then
    raise exception using errcode = '22023', message = 'invalid_platform_metadata';
  end if;
  if not exists (
    select 1 from public.brand_users membership
    where membership.user_id = p_actor_id
      and membership.role = 'platform_admin'
  ) then
    raise exception using errcode = '42501', message = 'platform_actor_required';
  end if;
  if not exists (select 1 from public.brands brand where brand.id = p_brand_id) then
    raise exception using errcode = '23503', message = 'platform_brand_not_found';
  end if;
  if p_location_id is not null and not exists (
    select 1 from public.locations location
    where location.id = p_location_id and location.brand_id = p_brand_id
  ) then
    raise exception using errcode = '23514', message = 'platform_location_outside_brand';
  end if;

  insert into public.platform_access_events (
    actor_id, brand_id, location_id, action, correlation_id, metadata
  ) values (
    p_actor_id, p_brand_id, p_location_id, p_action, p_correlation_id,
    coalesce(p_metadata, '{}'::jsonb)
  ) on conflict (action, correlation_id) do nothing;
end $$;

revoke all on function public.record_platform_access(uuid, uuid, uuid, text, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.record_platform_access(uuid, uuid, uuid, text, uuid, jsonb)
  to service_role;

-- Targeted config writers for an already-audited operate-as-brand action.
-- These repeat the database-side shape/size/secret guards of the home-tenant
-- RPCs because a service-role write must never rely on the browser validator.
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
  allowed constant text[] := array['tokens', 'copy', 'features', 'board'];
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
    jsonb_set(jsonb_set(jsonb_set(
      brand_config,
      '{tokens}', coalesce(brand_config -> 'tokens', '{}'::jsonb) || coalesce(p_config -> 'tokens', '{}'::jsonb)
    ), '{copy}', coalesce(brand_config -> 'copy', '{}'::jsonb) || coalesce(p_config -> 'copy', '{}'::jsonb)),
    '{features}', coalesce(brand_config -> 'features', '{}'::jsonb) || coalesce(p_config -> 'features', '{}'::jsonb)),
    '{board}', coalesce(brand_config -> 'board', '{}'::jsonb) || coalesce(p_config -> 'board', '{}'::jsonb)
  ) where id = p_brand_id returning updated_at into target.updated_at;
  return target.updated_at;
end $$;

revoke all on function public.set_platform_brand_settings_config(uuid, uuid, jsonb, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.set_platform_brand_settings_config(uuid, uuid, jsonb, uuid, timestamptz)
  to service_role;

create or replace function public.set_platform_kiosk_config(
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
declare target public.brands%rowtype; offending text;
begin
  perform app.require_platform_audit(
    p_actor_id, p_brand_id, null, 'kiosk.config.update', p_correlation_id
  );
  if jsonb_typeof(p_config) is distinct from 'object' or pg_column_size(p_config) > 16384 then
    raise exception using errcode = '22023', message = 'kiosk_config_too_large';
  end if;
  select key into offending from jsonb_each_text(jsonb_strip_nulls(p_config)) top(key, value)
  where key ~* '(passcode|secret|token|password|api_?key)' limit 1;
  if offending is not null or p_config ?| array['tax', 'loyalty', 'tokens', 'copy', 'identity', 'business', 'board'] then
    raise exception using errcode = '22023', message = 'invalid_kiosk_config';
  end if;
  if p_config::text ~* '"[^"]*(passcode|secret|password|api_key|apikey|access_token|refresh_token)[^"]*"[[:space:]]*:' then
    raise exception using errcode = '22023', message = 'kiosk_config_contains_secret';
  end if;
  select * into target from public.brands where id = p_brand_id for update;
  if target.id is null then raise exception using errcode = '23503', message = 'platform_brand_not_found'; end if;
  if p_expected_updated_at is not null and target.updated_at is distinct from p_expected_updated_at then
    raise exception using errcode = '40001', message = 'kiosk_config_stale';
  end if;
  update public.brands
  set brand_config = brand_config || jsonb_build_object('kiosk', p_config)
  where id = p_brand_id returning updated_at into target.updated_at;
  return target.updated_at;
end $$;

revoke all on function public.set_platform_kiosk_config(uuid, uuid, jsonb, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.set_platform_kiosk_config(uuid, uuid, jsonb, uuid, timestamptz)
  to service_role;

create or replace function public.get_platform_fee_terms(
  p_actor_id uuid,
  p_brand_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare result jsonb;
begin
  if not exists (
    select 1 from public.brand_users member
    where member.user_id = p_actor_id and member.role = 'platform_admin'
  ) then raise exception using errcode = '42501', message = 'platform_actor_required'; end if;
  select jsonb_build_object(
    'brand', jsonb_build_object(
      'feeBps', brand.fee_bps,
      'feeBpsTier2', brand.fee_bps_tier2,
      'tierThresholdCents', brand.tier_threshold_cents
    ),
    'locations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', location.id,
        'name', location.name,
        'feeBps', location.fee_bps,
        'feeBpsTier2', location.fee_bps_tier2,
        'tierThresholdCents', location.tier_threshold_cents
      ) order by location.name, location.id)
      from public.locations location where location.brand_id = brand.id
    ), '[]'::jsonb)
  ) into result
  from public.brands brand where brand.id = p_brand_id;
  if result is null then
    raise exception using errcode = '23503', message = 'platform_brand_not_found';
  end if;
  return result;
end $$;

revoke all on function public.get_platform_fee_terms(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.get_platform_fee_terms(uuid, uuid)
  to service_role;

create or replace function public.set_platform_location_fee_overrides(
  p_actor_id uuid,
  p_brand_id uuid,
  p_location_id uuid,
  p_correlation_id uuid,
  p_fee_bps integer,
  p_fee_bps_tier2 integer,
  p_tier_threshold_cents bigint
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare result_id uuid;
begin
  perform app.require_platform_audit(
    p_actor_id, p_brand_id, p_location_id, 'fees.location.update', p_correlation_id
  );
  if (p_fee_bps is not null and p_fee_bps not between 0 and 10000)
     or (p_fee_bps_tier2 is not null and p_fee_bps_tier2 not between 0 and 10000)
     or (p_tier_threshold_cents is not null and p_tier_threshold_cents < 0) then
    raise exception using errcode = '22023', message = 'invalid_location_fee_terms';
  end if;
  update public.locations set
    fee_bps = p_fee_bps,
    fee_bps_tier2 = p_fee_bps_tier2,
    tier_threshold_cents = p_tier_threshold_cents
  where id = p_location_id and brand_id = p_brand_id
  returning id into result_id;
  if result_id is null then
    raise exception using errcode = '23503', message = 'platform_location_not_found';
  end if;
  return result_id;
end $$;

revoke all on function public.set_platform_location_fee_overrides(uuid, uuid, uuid, uuid, integer, integer, bigint)
  from public, anon, authenticated;
grant execute on function public.set_platform_location_fee_overrides(uuid, uuid, uuid, uuid, integer, integer, bigint)
  to service_role;

-- AI extraction is a metered provider operation. Keep its budget in Postgres
-- so restarts and horizontally scaled HQ instances cannot reset the limit.
create table if not exists app.menu_extraction_budgets (
  brand_id uuid not null references public.brands(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  window_start timestamptz not null,
  request_count integer not null check (request_count between 1 and 10),
  primary key (brand_id, user_id, window_start)
);

revoke all on table app.menu_extraction_budgets
  from public, anon, authenticated, service_role;

create index if not exists menu_extraction_budgets_brand_window_idx
  on app.menu_extraction_budgets (brand_id, window_start);

create or replace function public.consume_menu_extraction_budget(
  p_brand_id uuid
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_count integer;
  brand_count bigint;
  target_window timestamptz := pg_catalog.date_trunc('hour', pg_catalog.clock_timestamp());
begin
  if actor_id is null or not exists (
    select 1 from public.brand_users member
    where member.user_id = actor_id
      and (
        (member.brand_id = p_brand_id and member.role = 'brand_owner')
        or member.role = 'platform_admin'
      )
  ) then
    raise exception using errcode = '42501', message = 'menu_extraction_not_authorized';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_brand_id::text || ':menu-extraction', 0)
  );
  delete from app.menu_extraction_budgets budget
  where budget.brand_id = p_brand_id
    and budget.window_start < target_window - interval '24 hours';

  select coalesce(sum(budget.request_count), 0) into brand_count
  from app.menu_extraction_budgets budget
  where budget.brand_id = p_brand_id and budget.window_start = target_window;
  select budget.request_count into actor_count
  from app.menu_extraction_budgets budget
  where budget.brand_id = p_brand_id
    and budget.user_id = actor_id
    and budget.window_start = target_window;

  if coalesce(actor_count, 0) >= 10 or brand_count >= 50 then return false; end if;
  insert into app.menu_extraction_budgets (
    brand_id, user_id, window_start, request_count
  ) values (
    p_brand_id, actor_id, target_window, 1
  ) on conflict (brand_id, user_id, window_start) do update
    set request_count = app.menu_extraction_budgets.request_count + 1;
  return true;
end $$;

revoke all on function public.consume_menu_extraction_budget(uuid)
  from public, anon;
grant execute on function public.consume_menu_extraction_budget(uuid)
  to authenticated;

-- Review-first ingestion finishes through one private transaction so category
-- and item rows either all land or all roll back together. Public wrappers
-- below establish either an exact home-tenant owner or an audited platform
-- operator before entering this helper.
create or replace function app.apply_brand_menu(
  p_brand_id uuid,
  p_rows jsonb
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_menu_id uuid;
  row_count integer;
begin
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception using errcode = '22023', message = 'invalid_menu_import';
  end if;
  if jsonb_array_length(p_rows) not between 1 and 500
     or pg_column_size(p_rows) > 1048576 then
    raise exception using errcode = '22023', message = 'invalid_menu_import';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_rows) source(row)
    where jsonb_typeof(row) is distinct from 'object'
      or jsonb_typeof(row -> 'slug') is distinct from 'string'
      or row ->> 'slug' !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
      or length(row ->> 'slug') > 80
      or jsonb_typeof(row -> 'name') is distinct from 'string'
      or length(btrim(row ->> 'name')) not between 1 and 120
      or jsonb_typeof(row -> 'category') is distinct from 'string'
      or length(btrim(row ->> 'category')) not between 1 and 120
      or length(coalesce(row ->> 'description', '')) > 1000
      or jsonb_typeof(row -> 'basePriceCents') is distinct from 'number'
      or case when row ->> 'basePriceCents' ~ '^[0-9]+$'
           then (row ->> 'basePriceCents')::numeric > 10000000 else true end
      or jsonb_typeof(row -> 'sizes') is distinct from 'array'
      or case when jsonb_typeof(row -> 'sizes') = 'array'
           then jsonb_array_length(row -> 'sizes') > 20 else true end
      or exists (
        select 1 from jsonb_array_elements(
          case when jsonb_typeof(row -> 'sizes') = 'array'
            then row -> 'sizes' else '[]'::jsonb end
        ) size(value)
        where jsonb_typeof(value) is distinct from 'object'
          or jsonb_typeof(value -> 'slug') is distinct from 'string'
          or value ->> 'slug' !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
          or length(value ->> 'slug') > 40
          or jsonb_typeof(value -> 'label') is distinct from 'string'
          or length(btrim(value ->> 'label')) not between 1 and 80
          or jsonb_typeof(value -> 'price_cents') is distinct from 'number'
          or case when value ->> 'price_cents' ~ '^[0-9]+$'
               then (value ->> 'price_cents')::numeric > 10000000 else true end
      )
  ) or exists (
    select 1 from jsonb_array_elements(p_rows) source(row)
    group by row ->> 'slug' having count(*) > 1
  ) then
    raise exception using errcode = '22023', message = 'invalid_menu_import_row';
  end if;

  insert into public.menus (brand_id, name, is_published)
  values (p_brand_id, 'Menu', true)
  on conflict (brand_id, name) do update set is_published = true
  returning id into target_menu_id;

  insert into public.menu_categories (brand_id, menu_id, slug, title, sort_order)
  select p_brand_id, target_menu_id,
    left(coalesce(nullif(trim(both '-' from regexp_replace(lower(title), '[^a-z0-9]+', '-', 'g')), ''), 'category'), 58)
      || '-' || left(md5(title), 8),
    title,
    coalesce((select max(existing.sort_order) + 1 from public.menu_categories existing
      where existing.menu_id = target_menu_id), 0) + row_number() over (order by title) - 1
  from (
    select distinct btrim(row ->> 'category') as title
    from jsonb_array_elements(p_rows) source(row)
  ) requested
  -- Installed by required predecessor 20260824072313. The release-readiness
  -- chain below prevents this migration from completing without that index.
  on conflict (menu_id, title) do nothing;

  insert into public.menu_items (
    brand_id, menu_id, category_id, slug, name, description,
    base_price_cents, sizes, sort_order
  )
  select p_brand_id, target_menu_id, category.id,
    row ->> 'slug', btrim(row ->> 'name'), coalesce(row ->> 'description', ''),
    (row ->> 'basePriceCents')::bigint, row -> 'sizes', ordinal - 1
  from jsonb_array_elements(p_rows) with ordinality source(row, ordinal)
  join public.menu_categories category
    on category.menu_id = target_menu_id
   and category.title = btrim(row ->> 'category')
  on conflict (menu_id, slug) do update set
    category_id = excluded.category_id,
    name = excluded.name,
    description = excluded.description,
    base_price_cents = excluded.base_price_cents,
    sizes = excluded.sizes,
    sort_order = excluded.sort_order;

  row_count := jsonb_array_length(p_rows);
  return row_count;
end $$;

revoke all on function app.apply_brand_menu(uuid, jsonb)
  from public, anon, authenticated, service_role;

create or replace function public.import_brand_menu(
  p_brand_id uuid,
  p_rows jsonb
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null
     or app.jwt_role() is distinct from 'brand_owner'
     or app.jwt_brand_id() is distinct from p_brand_id
     or not exists (
       select 1 from public.brand_users member
       where member.user_id = auth.uid()
         and member.brand_id = p_brand_id
         and member.role = 'brand_owner'
     ) then
    raise exception using errcode = '42501', message = 'brand_owner_required';
  end if;
  return app.apply_brand_menu(p_brand_id, p_rows);
end $$;

revoke all on function public.import_brand_menu(uuid, jsonb)
  from public, anon;
grant execute on function public.import_brand_menu(uuid, jsonb)
  to authenticated;

create or replace function public.import_platform_brand_menu(
  p_actor_id uuid,
  p_brand_id uuid,
  p_rows jsonb,
  p_correlation_id uuid
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.require_platform_audit(
    p_actor_id, p_brand_id, null, 'menu.import', p_correlation_id
  );
  return app.apply_brand_menu(p_brand_id, p_rows);
end $$;

revoke all on function public.import_platform_brand_menu(uuid, uuid, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.import_platform_brand_menu(uuid, uuid, jsonb, uuid)
  to service_role;

-- Keep hosted deploys fail-closed until the new invariants are installed.
alter function public.platform_release_readiness()
  rename to platform_release_readiness_20260831121801;
alter function public.platform_release_readiness_20260831121801() set schema app;
revoke all on function app.platform_release_readiness_20260831121801()
  from public, anon, authenticated;
grant execute on function app.platform_release_readiness_20260831121801()
  to service_role;

create or replace function public.platform_release_readiness()
returns text
language plpgsql stable security invoker set search_path = '' as $$
begin
  if app.platform_release_readiness_20260831121801() <> '20260831121801' then
    raise exception 'franchise admin readiness prerequisite is incomplete';
  end if;
  return '20260831171620';
end $$;

revoke all on function public.platform_release_readiness()
  from public, anon, authenticated;
grant execute on function public.platform_release_readiness()
  to service_role;
