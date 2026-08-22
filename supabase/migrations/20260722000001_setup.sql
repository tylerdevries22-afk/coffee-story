-- 0001: extensions, JWT claim helpers, and shared enums.
--
-- Tenancy claims ride in the JWT's app_metadata (set server-side at
-- signup/invite; app_metadata is not user-editable, unlike user_metadata):
--   { "brand_id": "<uuid>", "location_ids": ["<uuid>", ...], "role": "staff" }
-- End customers carry brand_id and no role. Roles are rule 8's four:
-- platform_admin, brand_owner, location_manager, staff.

create extension if not exists pgcrypto;

create schema if not exists app;

create or replace function app.jwt_claims() returns jsonb
language sql stable as $$
  select coalesce(auth.jwt() -> 'app_metadata', '{}'::jsonb)
$$;

create or replace function app.jwt_brand_id() returns uuid
language sql stable as $$
  select nullif(app.jwt_claims() ->> 'brand_id', '')::uuid
$$;

create or replace function app.jwt_role() returns text
language sql stable as $$
  select app.jwt_claims() ->> 'role'
$$;

create or replace function app.jwt_location_ids() returns uuid[]
language sql stable as $$
  select coalesce(
    (select array_agg(value::uuid)
       from jsonb_array_elements_text(app.jwt_claims() -> 'location_ids')),
    '{}'::uuid[]
  )
$$;

create or replace function app.is_platform_admin() returns boolean
language sql stable as $$
  select app.jwt_role() = 'platform_admin'
$$;

-- Brand staff of any rank: brand_owner sees the whole brand,
-- location_manager and staff are additionally scoped by location where a
-- table carries location_id.
create or replace function app.is_brand_staff(target_brand uuid) returns boolean
language sql stable as $$
  select app.is_platform_admin()
      or (app.jwt_brand_id() = target_brand
          and app.jwt_role() in ('brand_owner', 'location_manager', 'staff'))
$$;

create or replace function app.is_brand_owner(target_brand uuid) returns boolean
language sql stable as $$
  select app.is_platform_admin()
      or (app.jwt_brand_id() = target_brand and app.jwt_role() = 'brand_owner')
$$;

-- Location scope: brand_owner (and platform_admin) pass for any location of
-- the brand; managers and staff only for locations in their claim.
create or replace function app.at_location(target_brand uuid, target_location uuid) returns boolean
language sql stable as $$
  select app.is_brand_owner(target_brand)
      or (app.jwt_brand_id() = target_brand
          and app.jwt_role() in ('location_manager', 'staff')
          and target_location = any (app.jwt_location_ids()))
$$;

-- Rule 2's lifecycle. Everything downstream (the order_events trigger, the
-- engine's state machine, both apps) derives from this one enum.
create type app.order_status as enum
  ('created', 'paid', 'in_progress', 'ready', 'picked_up', 'cancelled', 'refunded');

-- The spec's fulfillment set plus delivery: the brand feature flag `delivery`
-- exists, so the enum has to be able to express it. Assumption stated in the
-- Phase 2 commit.
create type app.fulfillment_type as enum ('pickup', 'curbside', 'catering', 'delivery');

create type app.brand_role as enum
  ('platform_admin', 'brand_owner', 'location_manager', 'staff');

create type app.campaign_channel as enum ('push', 'sms', 'email');

create type app.order_channel as enum ('app', 'web', 'kiosk', 'pos');
