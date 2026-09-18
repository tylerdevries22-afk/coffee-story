-- Provisioning keeps what the new-organization wizard collects about the
-- first location: the Google Place it is, where it sits, its phone and its
-- website.
--
-- The wizard has sent all four since the Places work (#226, #228) -- inside
-- p_location, as `googlePlaceId`, `phone`, `website` and `address.lat` /
-- `address.lng` -- and provisioning dropped them: it inserted the name,
-- address, hours and time zone and nothing else. The address kept the
-- coordinates only because it was stored whole, unchecked.
--
-- Where each one lives:
--
-- - The Place id goes in `locations.google_place_id`, which 20260916090000
--   added with its shape check and its per-brand unique index.
-- - lat/lng stay inside `address`. That is the column's documented shape since
--   20260722000002 ("street, city, region, postal, lat/lng"), and the map pin
--   is part of where a location is.
-- - Phone and website get columns. Nothing reads a location's contact yet, so
--   either shape would do today; the first thing that does -- a lobby screen's
--   "call us", a store picker -- reads them as facts, and a fact is something
--   you constrain and select by name, which is the same reasoning
--   20260916090000 gave the Place id. A phone number is not part of an address,
--   and a check on a column holds every writer to it, not only this function.
--   Both are nullable with no backfill: no existing location was entered with
--   either, and inventing one would be worse than having none.
--
-- The function keeps its signature. The new values ride in p_location, whose
-- keys are optional: absent or null means "none", so every existing caller
-- behaves exactly as before. A new parameter instead would have been a second
-- overload -- ambiguous with the first while both have defaults -- and would
-- change an identity that scripts/hosted-advisor-policy.ts approves by exact
-- signature, and that three release assertions and
-- supabase/tests/franchise_provisioning_contract.test.sql look up the same way.
--
-- Each value is checked at the boundary, before anything commits, and refused
-- as `invalid_first_location` (22023) like the rest of the location: a Place id
-- in the column's shape; lat in [-90, 90] and lng in [-180, 180], both or
-- neither; a phone of 7 to 15 digits in at most 32 characters; an https
-- website of at most 2048. The console checks the same rules first
-- (apps/hq/lib/location-contact.ts) and adds one a database cannot: that the
-- website is a public address, which needs the hostname judged, not matched.
--
-- READ THIS BEFORE COPYING THIS FUNCTION AGAIN. The body below is copied from
-- 20260915120000, which is its current definition -- no later migration
-- touched it -- and it differs only in the place-field check and the three
-- columns added to the location insert. It still carries the 9000 bps fee
-- ceiling literally: 20260908227000 set that ceiling by patching the deployed
-- body at runtime, so copying from any migration older than 20260915120000
-- silently reverts it. app.assert_hospitality_industry() fails the release
-- if that happens, and app.assert_location_place_fields() below fails it if a
-- copy drops what this migration adds.

-- The phone and website rules, once, for the column checks and for the
-- provisioning check. A check constraint runs as whoever writes the row -- a
-- brand owner editing a location, an operator pausing ordering -- so
-- `authenticated` needs to execute these; `anon` never writes a location.
create or replace function app.is_dialable_phone(p_phone text) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(
    char_length(p_phone) <= 32
    and p_phone ~ '^\+?[0-9 ().-]+$'
    and char_length(pg_catalog.regexp_replace(p_phone, '[^0-9]', '', 'g')) between 7 and 15,
    false
  )
$$;
revoke all on function app.is_dialable_phone(text) from public, anon;
grant execute on function app.is_dialable_phone(text) to authenticated, service_role;

create or replace function app.is_https_website(p_website text) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(char_length(p_website) <= 2048 and p_website ~ '^https://[^[:space:]]+$', false)
$$;
revoke all on function app.is_https_website(text) from public, anon;
grant execute on function app.is_https_website(text) to authenticated, service_role;

alter table public.locations
  add column phone text
    constraint locations_phone_is_dialable
    check (phone is null or app.is_dialable_phone(phone)),
  add column website text
    constraint locations_website_is_https
    check (website is null or app.is_https_website(website));

comment on column public.locations.phone is
  'The location''s phone as the business writes it: 7 to 15 digits with the '
  'usual punctuation, at most 32 characters. Null when none was given.';
comment on column public.locations.website is
  'The location''s website, https only. Null when none was given.';

-- Everything provisioning accepts about the first location beyond its name,
-- address, hours and time zone. Each key is absent, null, or well formed;
-- anything else is a caller bug to refuse, not a value to guess at. Never
-- null itself: a null here would read as "valid" to the IF that calls it.
create or replace function app.location_place_fields_valid(p_location jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(
    -- The Place id, in the shape locations_google_place_id_is_opaque_id holds.
    (jsonb_typeof(coalesce(p_location->'googlePlaceId', 'null')) = 'null'
      or (jsonb_typeof(p_location->'googlePlaceId') = 'string'
        and p_location->>'googlePlaceId' ~ '^[A-Za-z0-9_-]{6,255}$'))
    and (jsonb_typeof(coalesce(p_location->'phone', 'null')) = 'null'
      or (jsonb_typeof(p_location->'phone') = 'string'
        and app.is_dialable_phone(p_location->>'phone')))
    and (jsonb_typeof(coalesce(p_location->'website', 'null')) = 'null'
      or (jsonb_typeof(p_location->'website') = 'string'
        and app.is_https_website(p_location->>'website')))
    -- The map pin: both or neither, since half a coordinate is worse than none.
    and case
      when jsonb_typeof(coalesce(p_location #> '{address,lat}', 'null')) = 'null'
        and jsonb_typeof(coalesce(p_location #> '{address,lng}', 'null')) = 'null' then true
      when jsonb_typeof(p_location #> '{address,lat}') = 'number'
        and jsonb_typeof(p_location #> '{address,lng}') = 'number' then
        (p_location #>> '{address,lat}')::numeric between -90 and 90
        and (p_location #>> '{address,lng}')::numeric between -180 and 180
      else false
    end,
    false
  )
$$;
revoke all on function app.location_place_fields_valid(jsonb) from public, anon, authenticated;
grant execute on function app.location_place_fields_valid(jsonb) to service_role;

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
       or length(coalesce(p_location->>'timezone', '')) not between 3 and 80
       or not app.location_place_fields_valid(p_location) then
      raise exception using errcode = '22023', message = 'invalid_first_location';
    end if;
    insert into public.locations (
      brand_id, name, address, hours, timezone, google_place_id, phone, website
    ) values (
      created_brand_id, btrim(p_location->>'name'), coalesce(p_location->'address', '{}'::jsonb),
      coalesce(p_location->'hours', '{}'::jsonb), p_location->>'timezone',
      p_location->>'googlePlaceId', p_location->>'phone', p_location->>'website'
    ) returning id into created_location_id;
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

-- Release readiness: the columns only mean something while their checks
-- stand, and the function only stores the fields while its body still checks
-- and writes them -- which a future `create or replace` copied from an older
-- migration would quietly undo.
create or replace function app.assert_location_place_fields()
returns void language plpgsql stable security invoker set search_path = '' as $$
declare
  body text;
begin
  if (
    select count(*) from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.locations'::regclass
      and constraint_row.conname in ('locations_phone_is_dialable', 'locations_website_is_https')
  ) <> 2 then
    raise exception 'locations lost the check on its phone or its website';
  end if;
  body := pg_catalog.pg_get_functiondef(
    'public.provision_platform_organization(uuid,text,text,uuid,text,text,text,text,jsonb,jsonb,jsonb,text,jsonb,jsonb,integer,integer,bigint)'::regprocedure
  );
  if body !~ 'app\.location_place_fields_valid\(p_location\)' then
    raise exception 'provisioning no longer checks the first location''s place fields';
  end if;
  if body !~ 'google_place_id, phone, website' then
    raise exception 'provisioning no longer stores the first location''s place fields';
  end if;
  if app.location_place_fields_valid('{"address": {"lat": 91, "lng": 0}}'::jsonb)
     or app.location_place_fields_valid('{"address": {"lat": 45}}'::jsonb)
     or not app.location_place_fields_valid(
       '{"googlePlaceId": "ChIJHarborRoast0001", "phone": "+1 253-555-0142",
         "website": "https://harbor-roast.example.com/",
         "address": {"lat": 47.2529, "lng": -122.4443}}'::jsonb
     ) then
    raise exception 'the first location''s place fields are no longer judged correctly';
  end if;
end
$$;

revoke all on function app.assert_location_place_fields()
  from public, anon, authenticated;
grant execute on function app.assert_location_place_fields() to service_role;

select app.register_release(
  '20260918140000',
  'provisioning stores the first location''s Google Place id, map pin, phone and website, each checked at the boundary',
  'app.assert_location_place_fields()'::regprocedure
);
