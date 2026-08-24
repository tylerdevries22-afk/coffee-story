-- 0030: the claim helpers answer false, not null.
--
-- app.jwt_role() is null for any principal without a staff role -- an
-- anonymous guest, and every paired device, since a device claim deliberately
-- carries no role at all. `null in ('brand_owner', ...)` is NULL rather than
-- false under SQL's three-valued logic, so the helpers returned NULL for
-- exactly the callers they are meant to reject.
--
-- That was never a hole: a policy's USING clause treats NULL as deny, and so
-- does every `a or b` combination of these, so the effect was already
-- fail-closed. It is a footgun rather than a bug. `not app.is_brand_staff(x)`
-- reads as "anyone who is not staff" and evaluates to NULL for precisely the
-- non-staff it was written to catch -- which denies, but denies for a reason
-- the author did not intend and would not find by reading.
--
-- A question shaped "is this principal brand staff?" should answer yes or no.

create or replace function app.is_platform_admin() returns boolean
language sql stable as $$
  select coalesce(app.jwt_role() = 'platform_admin', false)
$$;

create or replace function app.is_brand_staff(target_brand uuid) returns boolean
language sql stable as $$
  select coalesce(
    app.is_platform_admin()
    or (app.jwt_brand_id() = target_brand
        and app.jwt_role() in ('brand_owner', 'location_manager', 'staff')),
    false)
$$;

create or replace function app.is_brand_owner(target_brand uuid) returns boolean
language sql stable as $$
  select coalesce(
    app.is_platform_admin()
    or (app.jwt_brand_id() = target_brand and app.jwt_role() = 'brand_owner'),
    false)
$$;

create or replace function app.at_location(target_brand uuid, target_location uuid) returns boolean
language sql stable as $$
  select coalesce(
    app.is_brand_owner(target_brand)
    or (app.jwt_brand_id() = target_brand
        and app.jwt_role() in ('location_manager', 'staff')
        and target_location = any (app.jwt_location_ids())),
    false)
$$;
