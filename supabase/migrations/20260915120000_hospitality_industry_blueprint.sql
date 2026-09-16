-- Hospitality joins the industries a platform organization may be provisioned
-- into.
--
-- Adding a vertical is four synchronized edits, and two of them are here: the
-- blueprint row the provisioning RPC requires to be `active`, and the
-- industry/blueprint pair allowlist inside that RPC. The other two are on
-- disk: `industries/hospitality/blueprint.json` and the `hospitality` entry in
-- `INDUSTRY_COPY`, both guarded by tests/consistency/src/industry-copy-packs.
--
-- The pair check is an inline allowlist inside a 240-line security-definer
-- function, and Postgres has no way to amend a function body in place, so the
-- whole function is replaced. It was copied from
-- 20260904100345_franchise_provisioning_contract.sql.
--
-- READ THIS BEFORE COPYING THIS FUNCTION AGAIN. That migration is NOT the
-- function's current definition, and no migration file is: 20260908227000
-- (repair_bounded_claims) rewrites the deployed body at runtime with
-- pg_get_functiondef + replace + execute, tightening the Square fee ceiling
-- from 10000 to 9000 bps for both p_fee_bps and p_fee_bps_tier2. A plain copy
-- of 20260904100345 therefore silently REVERTS that tightening -- which is
-- exactly what the first draft of this migration did, caught by
-- supabase/tests/platform_fee_rpc_security.test.sql ("organization writer
-- rejects rates above the provider ceiling"), the test that exists for it.
--
-- So this body carries the 9000 ceiling literally rather than inheriting it
-- from a runtime patch, and the only differences from 20260904100345 are that
-- ceiling on both fee parameters plus the one added industry pair.
--
-- `applicationSurfaces` lists the five built surfaces, matching every other
-- blueprint. `lobby` is declarable but not yet built, so it is deliberately
-- absent here and joins when the surface ships.

insert into public.industry_blueprints (
  industry_key, version, name, locale, supabase_region, manifest, status
) values (
  'hospitality', 1, 'Hospitality', 'en-US', 'us-west-1',
  jsonb_build_object(
    'schemaVersion', 1, 'key', 'hospitality', 'name', 'Hospitality',
    'templateVersion', 1, 'locale', 'en-US', 'supabaseRegion', 'us-west-1',
    'applicationSurfaces', jsonb_build_array('hq', 'display', 'customer', 'operator', 'kiosk'),
    'recommendedModules', jsonb_build_array('commerce-catalog'),
    'vocabulary', jsonb_build_object(
      'catalog', 'Experience catalog', 'folder', 'Collection',
      'offering', 'Experience', 'resource', 'Guide'
    )
  ), 'active'
)
on conflict (industry_key, version) do update set
  name = excluded.name, locale = excluded.locale,
  supabase_region = excluded.supabase_region, manifest = excluded.manifest,
  status = excluded.status, updated_at = now();

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
       or (p_industry_key = 'hospitality' and p_blueprint_key = 'hospitality')
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
     or p_fee_bps not between 0 and 9000 or p_fee_bps_tier2 not between 0 and 9000
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


-- Release readiness: a provisioning path that silently drops the vertical is
-- the failure this guards. Both halves must hold -- an active blueprint row
-- with no pair in the allowlist provisions nothing, and a pair with no active
-- row raises `active_industry_blueprint_not_found` at call time instead.
create or replace function app.assert_hospitality_industry()
returns void language plpgsql security definer set search_path = '' as $$
declare
  body text;
begin
  if not exists (
    select 1 from public.industry_blueprints blueprint
    where blueprint.industry_key = 'hospitality'
      and blueprint.status = 'active'
  ) then
    raise exception 'hospitality has no active industry blueprint';
  end if;
  body := pg_catalog.pg_get_functiondef(
    'public.provision_platform_organization(uuid,text,text,uuid,text,text,text,text,jsonb,jsonb,jsonb,text,jsonb,jsonb,integer,integer,bigint)'::regprocedure
  );
  if body !~ 'hospitality' then
    raise exception 'provisioning no longer permits the hospitality industry pair';
  end if;
  if body !~ 'coffee-shop' or body !~ 'construction' then
    raise exception 'provisioning lost an industry pair it previously permitted';
  end if;
  -- The Square fee ceiling reached this function through a runtime patch in
  -- 20260908227000, so any future `create or replace` copied from an older
  -- migration silently loosens it back to 10000. That is not hypothetical --
  -- the first draft of this migration did it. Fail the release instead.
  if body ~ 'not between 0 and 10000' then
    raise exception 'provisioning reverted the Square fee ceiling to 10000 bps';
  end if;
end
$$;

revoke all on function app.assert_hospitality_industry()
  from public, anon, authenticated;
grant execute on function app.assert_hospitality_industry() to service_role;

select app.register_release(
  '20260915120000',
  'hospitality is provisionable: an active industry blueprint plus the matching industry/blueprint pair in the provisioning allowlist',
  'app.assert_hospitality_industry()'::regprocedure
);
