-- A franchise agreement can end. Until now the platform had no way to say so.
--
-- The only brand-level removal primitive in the whole schema is
-- `brands_delete` (20260722000007_rls.sql:15), and 92 tables declare
-- `references public.brands (id) on delete cascade`. The cascade is not merely
-- allowed to erase the audit trail, it is *designed* to:
-- app.reject_module_installation_event_mutation admits pg_trigger_depth() > 1
-- (20260902083817:87-99) precisely so a nested cascade can clean history up.
-- So the day a separation turns contested, the one available action destroys
-- the evidence. Meanwhile nothing revokes a departing franchisee's access:
-- brand_users is untouched, device revocation is per-installation
-- (app.revoke_device_installation, 20260902021857:305, called one at a time
-- from apps/hq/lib/device-wall-actions.ts), and a delegated analyst keeps
-- reading network KPIs until the grant's 30-day cap expires on its own.
--
-- This migration adds the state that should exist between "operating" and
-- "gone": suspended. Access stops; every row stays exactly where it is.
--
-- DATA EXPORT IS OUT OF SCOPE and deliberately so. Handing a departing
-- franchisee a portable copy of their own operating data is real work -- a
-- format, a redaction boundary against platform-side commercial terms, a
-- delivery channel, a retention clock -- and none of it is urgent in the way
-- revoking access is. 'offboarded' is reserved in the CHECK below and set by
-- nothing here, so the migration that builds export-then-delete can move a
-- brand into it without taking an ACCESS EXCLUSIVE lock to rewrite a
-- constraint. Suspension is the cheap, urgent half; this is only that half.
--
-- Cost: one ALTER TABLE ADD COLUMN with a non-volatile default, which PG11+
-- does without a table rewrite, holding ACCESS EXCLUSIVE on public.brands for
-- the catalog update only -- one row per tenant, four tenants today. The three
-- CREATE OR REPLACE FUNCTIONs are catalog-only. Nothing is backfilled: the
-- default makes every existing brand 'active', which is what they are.

alter table public.brands
  add column status text not null default 'active'
  constraint brands_status_is_known
  check (status in ('active', 'suspended', 'offboarded'));

comment on column public.brands.status is
  'Tenant lifecycle. active: normal operation. suspended: the agreement is '
  'paused or ending -- app.is_brand_staff, app.is_brand_owner and '
  'app.at_location all answer false, so every RLS policy gated on any of the '
  'three denies, while every row is preserved for a contested separation. '
  'offboarded: reserved '
  'for the export-then-delete work; nothing sets it yet.';

-- No column-level grant work. public.brands carries no column-level ACL (the
-- fee-terms revoke in 20260722000031 is on public.locations, and
-- invariants.test.ts pins it there), so the new column is covered by the
-- table-level default privileges the rest of the row already relies on. It is
-- not published to anon either: brands_select has been staff-only since
-- 20260722000019, and app.brand_storefront_rows projects a fixed column list
-- that this is not in.

-- The status read, and the recursion decision --------------------------------
--
-- app.is_brand_staff currently reads no table. Making it consult
-- public.brands is the whole point of this migration and also its one real
-- hazard, because brands_select is
--
--   using (app.is_platform_admin() or app.is_brand_staff(id))
--
-- in force from 20260722000019 -- NOT the `id = app.jwt_brand_id()` form that
-- 20260722000007 originally created. A security *invoker* read of
-- public.brands from inside is_brand_staff would therefore be filtered by
-- brands_select, which calls is_brand_staff, which reads public.brands.
--
-- Reproduced on a throwaway PostgreSQL 17 cluster while writing this, because
-- the failure signature is worth knowing exactly and it is not the one you
-- would guess. The invoker variant does NOT raise 42P17, "infinite recursion
-- detected in policy for relation brands" -- that detector only fires when a
-- policy expression references its own table directly. Routed through a
-- function boundary the detector never trips and the backend runs the cycle
-- until it dies: `ERROR: stack depth limit exceeded` (54001), preceded by a
-- context stack alternating `SQL function "brand_is_active" statement 1` and
-- `SQL function "is_brand_staff" statement 1`. Anyone who ever sees that pair
-- in a log is looking at this decision having been undone.
--
-- So this helper is `security definer`. It executes as its owner, which also
-- owns public.brands, and a table owner is exempt from its own row policies
-- unless the table carries FORCE ROW LEVEL SECURITY. public.brands does not
-- (only the analytics_* tables in 20260827192547 do). No policy is evaluated
-- on this read, so there is no cycle at all. Verified on the same cluster with
-- a deliberately non-superuser, non-BYPASSRLS owner, so the exemption being
-- relied on is the plain table-owner one and not a superuser shortcut: a
-- brand_owner of an active brand reads their row, a brand_owner of a suspended
-- brand reads nothing, and a platform_admin reads both.
--
-- That exemption is the load-bearing premise of the entire design and it is
-- invisible in this file, so app.assert_brand_lifecycle_suspension() asserts
-- it against the catalog below. `alter table public.brands force row level
-- security` reads like hardening and brings the stack blowout straight back --
-- also confirmed on that cluster, which is why it is gated rather than trusted.
--
-- `set search_path = ''` with public.brands written out, as every definer added
-- since 20260824100000 does; 20260903210000 additionally revoked CREATE on
-- public, so there is no schema left to shadow it from.
--
-- The two alternatives, and why not:
--   * A denormalized `brand_suspended` boolean on every tenant table, so the
--     policies never leave the row they are already filtering. That is 92
--     columns, 92 backfills, and 92 chances for one to drift out of step with
--     public.brands -- trading a bounded correctness question for an unbounded
--     consistency one.
--   * Carrying status in the JWT via app.custom_access_token. Free at read
--     time, and wrong: a token already minted keeps its claim, so suspension
--     would not take effect until every existing session expired. Revocation
--     that waits an hour is not revocation.
--
-- exists() rather than a scalar read, so an unknown brand id answers false
-- instead of null. Fail closed, and it keeps the coalesce() in the callers
-- honest rather than load-bearing.
create or replace function app.brand_is_active(target_brand uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.brands brand
    where brand.id = target_brand and brand.status = 'active'
  )
$$;

-- World-executable, exactly like the claim helpers in 20260722000001 and the
-- franchise membership helpers in 20260902083817, and for the reason stated
-- there: a policy expression runs with the *querying* role's function
-- privileges. Revoking this from anon would not deny an anonymous read of a
-- table whose policy carries an `is_brand_staff` disjunct -- it would abort it
-- with 42501, turning a clean deny into an error on the guest path. There is
-- no grant statement here on purpose; a `revoke` followed by re-granting the
-- same set would be theatre.
--
-- The disclosure that buys: any holder of the publishable key can ask whether
-- a brand id is active, and brand_storefront_lookup already resolves a public
-- slug to that id. So anon can learn "this tenant is suspended" -- which is
-- the same fact the tenant's dark storefront announces. Accepted, and it is
-- also load-bearing on the console side: once is_brand_staff answers false,
-- a suspended brand's owner cannot read their own brands row through
-- brands_select, so this function is the only way HQ can tell an explanatory
-- banner from a genuine outage.
comment on function app.brand_is_active(uuid) is
  'True only for a brand whose status is active. security definer because '
  'brands_select calls app.is_brand_staff, so a security invoker read of '
  'public.brands from inside that helper raises 42P17; the owner is exempt '
  'from brands policies because public.brands is not FORCE ROW LEVEL '
  'SECURITY, which app.assert_brand_lifecycle_suspension() pins.';

-- The chokepoint ------------------------------------------------------------
--
-- Reproduced whole from 20260722000032 with one conjunct added to each, rather
-- than patched, for the reason 20260903170000 gives about
-- set_module_installation_state: a CREATE OR REPLACE that drops a branch by
-- accident is how an authorization helper loses a role.
--
-- Signature, parameter name and return type are byte-identical to
-- 20260722000032 in all three. CREATE OR REPLACE cannot change any of them --
-- PostgreSQL raises 42P13 at apply time, which is after every check a pull
-- request runs -- and packages/schema/src/function-replacement.test.ts now
-- catches it statically. No drop is needed, so no ACL is discarded and there
-- are no grants to restate.
--
-- `set search_path = ''` is added to all three, and it is NOT a new
-- restriction: it is what they already run with. None of the three carries the
-- clause in its own DDL, so it is invisible in every version of these
-- functions anyone has ever read -- but 20260824072313's closing DO block
-- swept `alter function ... set search_path = ''` across every function in
-- schema app, invoker helpers included, and it has been in force ever since.
--
-- CREATE OR REPLACE replaces the whole definition including SET clauses, so
-- omitting the clause here would silently strip the pin from the three most
-- security-critical functions in the schema. 20260830002000's comment names
-- this exact trap ("what went missing is not in it") and its readiness link
-- guards it -- for jwt_brand_id and jwt_location_ids only. These three are not
-- in that check and nothing else covers them, so omitting the clause would
-- have regressed silently and stayed green. Confirmed on the throwaway
-- cluster: a function created with the clause and then replaced without it
-- comes back with proconfig NULL.
--
-- app.is_platform_admin() stays the leading disjunct in all three. That is not
-- stylistic: a platform admin who loses access to a brand the moment they
-- suspend it cannot restore it, cannot read the audit trail, and cannot
-- administer the separation they were hired to administer. The new conjunct is
-- inside the tenant-claim branch and cannot be reached from the admin one, and
-- the assertion below states the ordering so a later edit cannot quietly
-- invert it.
--
-- service_role is unaffected, confirmed rather than assumed, and for two
-- independent reasons. It has BYPASSRLS, so no policy expression -- and
-- therefore none of these three helpers -- is evaluated for it at all. And
-- even when a definer body calls one directly, service_role carries no
-- app_metadata: app.jwt_role() is null, so is_platform_admin() is false and
-- the tenant branch's jwt_brand_id() comparison is null. All three already
-- answered false for service_role before this migration and still do. The
-- engine's writes go through packages/engine under the service key and are
-- untouched by suspension, which is deliberate -- an in-flight order at a
-- brand suspended mid-shift still settles.
--
-- Ordering inside the tenant branch is deliberate too: the claim comparisons
-- are free, brand_is_active is a primary-key probe on a table with one row per
-- tenant. Putting the probe last means the common cross-tenant denial never
-- reaches it. (SQL does not guarantee AND short-circuits; this is a planner
-- courtesy, not a correctness argument. The correctness argument is that the
-- probe is a cached index lookup either way.)
create or replace function app.is_brand_staff(target_brand uuid) returns boolean
language sql stable set search_path = '' as $$
  select coalesce(
    app.is_platform_admin()
    or (app.jwt_brand_id() = target_brand
        and app.jwt_role() in ('brand_owner', 'location_manager', 'staff')
        and app.brand_is_active(target_brand)),
    false)
$$;

-- is_brand_owner needs the same conjunct or suspension leaks a write path:
-- brands_update, locations_write and locations_delete are gated on this helper
-- and not on is_brand_staff, so a suspended brand's owner would keep editing
-- the tenant they are being separated from.
create or replace function app.is_brand_owner(target_brand uuid) returns boolean
language sql stable set search_path = '' as $$
  select coalesce(
    app.is_platform_admin()
    or (app.jwt_brand_id() = target_brand
        and app.jwt_role() = 'brand_owner'
        and app.brand_is_active(target_brand)),
    false)
$$;

-- at_location's first disjunct delegates to is_brand_owner and so is already
-- gated by the change above, but its second is independent: it authorizes a
-- location_manager or staff member straight from their own claim. Without the
-- conjunct here, every location-scoped policy -- the operator app's whole
-- surface -- would keep working at a suspended brand while the brand-scoped
-- ones denied. The brief for this work called this helper
-- `app.is_location_member`; no such function exists, and app.at_location
-- (20260722000001:60, replaced by 20260722000032:40) is the one it means.
create or replace function app.at_location(target_brand uuid, target_location uuid) returns boolean
language sql stable set search_path = '' as $$
  select coalesce(
    app.is_brand_owner(target_brand)
    or (app.jwt_brand_id() = target_brand
        and app.jwt_role() in ('location_manager', 'staff')
        and target_location = any (app.jwt_location_ids())
        and app.brand_is_active(target_brand)),
    false)
$$;

-- The writers ---------------------------------------------------------------
--
-- Modelled on public.create_platform_organization (20260831171620:284): the
-- actor is resolved from auth.uid() in the body and is NOT a parameter. That
-- is what makes it safe to grant these to `authenticated`, and
-- 20260904000000 makes it a release-gated invariant -- the eight writers that
-- take p_actor_id as an argument authorize against an identity their caller
-- chooses, so they stay service-role only. A suspend button in the console
-- has to be reachable by a signed-in platform admin, so these two take the
-- create_platform_organization shape instead. `(select auth.uid())` rather
-- than a bare call, so it is evaluated once as an InitPlan.
--
-- The audit row goes to public.platform_access_events, whose
-- platform_access_immutable trigger is `before update or delete` only
-- (20260831000000:84) -- an insert is the one mutation it permits, which is
-- what append-only means here. The correlation id is generated rather than
-- accepted: the signature is fixed at two arguments, and the unique index on
-- (action, correlation_id) exists to deduplicate a retried service call, not
-- to deduplicate a lifecycle transition. Idempotency is enforced by reading
-- the current status under a row lock instead, so a double-click writes one
-- audit row rather than two. pg_catalog.gen_random_uuid() is qualified for
-- consistency with the empty search_path even though pg_catalog is implicitly
-- searched.
--
-- What suspension does NOT do, deliberately: it does not delete or demote a
-- single public.brand_users row. Those rows are the record of who held access
-- and at what rank, which is exactly the evidence a contested separation turns
-- on. The status gate makes them inert without erasing them. The claims hook
-- is likewise unchanged, so a suspended brand's staff still receive a
-- well-formed token carrying brand_id and role -- and every policy denies it.
-- Their session is valid and worthless, which is the correct shape: nothing
-- has to be rebuilt to un-suspend them.
create or replace function public.suspend_brand(p_brand_id uuid, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  current_status text;
  installation record;
  devices integer := 0;
  grants_revoked integer := 0;
begin
  if actor_id is null or not exists (
    select 1 from public.brand_users member
    where member.user_id = actor_id and member.role = 'platform_admin'
  ) then
    raise exception using errcode = '42501', message = 'platform_actor_required';
  end if;
  -- A suspension with no stated reason is the one that cannot be defended
  -- later, so the reason is required rather than nullable.
  if pg_catalog.length(pg_catalog.btrim(coalesce(p_reason, ''))) not between 4 and 500 then
    raise exception using errcode = '22023', message = 'invalid_suspension_reason';
  end if;

  -- The row lock serializes concurrent suspend/restore of the same brand, so
  -- the status read below and the writes that follow cannot interleave.
  select brand.status into current_status
    from public.brands brand
   where brand.id = p_brand_id
     for update;
  if not found then
    raise exception using errcode = '23503', message = 'platform_brand_not_found';
  end if;
  if current_status = 'offboarded' then
    raise exception using errcode = '22023', message = 'brand_already_offboarded';
  end if;
  -- Idempotent, and idempotent means no second audit row: re-suspending an
  -- already-suspended brand is not an event.
  if current_status = 'suspended' then
    return false;
  end if;

  update public.brands brand set status = 'suspended' where brand.id = p_brand_id;

  -- Every installation, not one at a time. app.revoke_device_installation is
  -- reused rather than inlined because it does three things this must not skip:
  -- it ends live stream sessions, writes an 'ended'/'installation_revoked' row
  -- per session to device_stream_audit_events, and only then stamps revoked_at.
  -- An inline `update ... set revoked_at = now()` would leave a revoked iPad
  -- holding an open WebRTC session and no audit record of it closing.
  for installation in
    select target.id from public.device_installations target
     where target.brand_id = p_brand_id and target.revoked_at is null
     order by target.id
       for update
  loop
    perform app.revoke_device_installation(installation.id, p_brand_id);
    devices := devices + 1;
  end loop;

  -- Every delegated grant on this brand, which is what actually cuts a
  -- franchisor's analyst off: public.caller_network_brand_kpis filters
  -- `revoked_at is null and expires_at > now()` in both its authorization
  -- check and its brand projection (20260903193000:100,138), so stamping
  -- revoked_at ends the read now instead of when the 30-day cap lapses.
  update public.delegated_access_grants grant_row
     set revoked_at = pg_catalog.now()
   where grant_row.brand_id = p_brand_id and grant_row.revoked_at is null;
  get diagnostics grants_revoked = row_count;

  insert into public.platform_access_events (
    actor_id, brand_id, location_id, action, correlation_id, metadata
  ) values (
    actor_id, p_brand_id, null, 'brands.suspend', pg_catalog.gen_random_uuid(),
    jsonb_build_object(
      'reason', pg_catalog.btrim(p_reason),
      'from_status', current_status,
      'to_status', 'suspended',
      'devices_revoked', devices,
      'grants_revoked', grants_revoked,
      'surface', 'hq')
  );
  return true;
end $$;

revoke all on function public.suspend_brand(uuid, text) from public, anon;
grant execute on function public.suspend_brand(uuid, text) to authenticated;

comment on function public.suspend_brand(uuid, text) is
  'Suspend a tenant in one transaction: status to suspended, every device '
  'installation revoked, every delegated access grant revoked, one audit row. '
  'platform_admin only, actor from auth.uid(), idempotent. Deletes nothing -- '
  'no brand_users row, no history. Reversible via public.restore_brand.';

-- Reversible, because a suspension that cannot be lifted is a delete with
-- extra steps -- and because the first thing anyone will do with this is
-- suspend the wrong brand.
--
-- What it restores is authorization and nothing else. Device installations and
-- delegated grants stay revoked, on purpose: revoked_at is a fact about a
-- point in time, and un-stamping it would rewrite history to claim an iPad was
-- never cut off. Re-pairing a device and re-issuing a grant are the existing
-- flows for that, both already audited. The audit row says so explicitly so
-- whoever restores a brand and finds the iPads dark can read why.
create or replace function public.restore_brand(p_brand_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  current_status text;
begin
  if actor_id is null or not exists (
    select 1 from public.brand_users member
    where member.user_id = actor_id and member.role = 'platform_admin'
  ) then
    raise exception using errcode = '42501', message = 'platform_actor_required';
  end if;

  select brand.status into current_status
    from public.brands brand
   where brand.id = p_brand_id
     for update;
  if not found then
    raise exception using errcode = '23503', message = 'platform_brand_not_found';
  end if;
  -- Terminal. Whatever moves a brand out of 'offboarded' belongs in the
  -- migration that learns how to put one there, with the export it implies.
  if current_status = 'offboarded' then
    raise exception using errcode = '22023', message = 'brand_already_offboarded';
  end if;
  if current_status = 'active' then
    return false;
  end if;

  update public.brands brand set status = 'active' where brand.id = p_brand_id;

  insert into public.platform_access_events (
    actor_id, brand_id, location_id, action, correlation_id, metadata
  ) values (
    actor_id, p_brand_id, null, 'brands.restore', pg_catalog.gen_random_uuid(),
    jsonb_build_object(
      'from_status', current_status,
      'to_status', 'active',
      'devices_restored', false,
      'grants_restored', false,
      'surface', 'hq')
  );
  return true;
end $$;

revoke all on function public.restore_brand(uuid) from public, anon;
grant execute on function public.restore_brand(uuid) to authenticated;

comment on function public.restore_brand(uuid) is
  'Lift a suspension: status back to active, one audit row. platform_admin '
  'only, actor from auth.uid(), idempotent. Does not un-revoke devices or '
  'delegated grants -- those are re-paired and re-issued through their own '
  'audited flows, because revoked_at is a historical fact.';

-- Readiness -----------------------------------------------------------------
--
-- Stated against the catalog wherever a catalog fact will do. Each of these is
-- something that would break silently: a lockout nobody notices until a tenant
-- calls, or a hole nobody notices at all.
create or replace function app.assert_brand_lifecycle_suspension()
returns void language plpgsql stable security invoker set search_path = '' as $$
declare
  -- Every function this migration creates or replaces must carry an empty
  -- search_path. Checked in one loop rather than three predicates so a
  -- function added later is covered by adding one line.
  pinned constant text[] := array[
    'app.brand_is_active(uuid)',
    'app.is_brand_staff(uuid)',
    'app.is_brand_owner(uuid)',
    'app.at_location(uuid, uuid)',
    'public.suspend_brand(uuid, text)',
    'public.restore_brand(uuid)'
  ];
  target text;
  staff_body text;
  admin_at integer;
  status_at integer;
begin
  -- 1. The column and its CHECK.
  if not exists (
    select 1 from pg_catalog.pg_attribute attribute
    where attribute.attrelid = 'public.brands'::regclass
      and attribute.attname = 'status'
      and attribute.attnotnull
      and not attribute.attisdropped
  ) then raise exception 'public.brands.status is missing or nullable'; end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.brands'::regclass
      and constraint_row.conname = 'brands_status_is_known'
      and constraint_row.contype = 'c'
      and pg_catalog.pg_get_constraintdef(constraint_row.oid) like '%active%'
      and pg_catalog.pg_get_constraintdef(constraint_row.oid) like '%suspended%'
      and pg_catalog.pg_get_constraintdef(constraint_row.oid) like '%offboarded%'
  ) then raise exception 'the brands.status lifecycle CHECK is missing or no longer names all three states'; end if;

  -- 2. The premise the whole design rests on. A table owner is exempt from its
  --    own policies only while the table is not FORCE ROW LEVEL SECURITY.
  --    Force it and app.brand_is_active starts being filtered by
  --    brands_select, which calls app.is_brand_staff, which calls
  --    app.brand_is_active -- a cycle that runs until the backend dies with
  --    'stack depth limit exceeded' (54001), on every staff read on the
  --    platform. Confirmed by forcing RLS on a throwaway cluster. This is a
  --    one-word ALTER that looks like hardening, which is why it is gated.
  if exists (
    select 1 from pg_catalog.pg_class
    where oid = 'public.brands'::regclass and relforcerowsecurity
  ) then raise exception 'public.brands is FORCE ROW LEVEL SECURITY, so app.brand_is_active recurses through brands_select until the backend exceeds its stack depth'; end if;

  -- 3. The status read: present, definer, pinned search path, and reachable by
  --    every role that evaluates a policy. Losing anon's EXECUTE turns an
  --    anonymous read of any table with an is_brand_staff disjunct into 42501
  --    instead of an empty result.
  if pg_catalog.to_regprocedure('app.brand_is_active(uuid)') is null then
    raise exception 'app.brand_is_active is missing';
  end if;
  -- proconfig, carefully, because the obvious predicate is wrong.
  --
  -- `set search_path = ''` -- inline in CREATE or via ALTER, they serialize
  -- identically -- stores the value as a QUOTED empty identifier. Matching the
  -- entry against an unquoted spelling is therefore never true, which is how
  -- 20260903210000 shipped an assertion that could only raise; because these
  -- checks raise on violation and platform_release_readiness() runs every
  -- registered assertion, that one predicate took the whole release gate red.
  -- Repaired by the coordinator in 20260904005000, independently of this file.
  --
  -- So this reads the VALUE rather than matching the entry: split the proconfig
  -- entry on '=', require the name to be search_path, and require what follows
  -- to be empty once quotes are trimmed. That holds under either serialization
  -- and cannot be satisfied by a non-empty path.
  foreach target in array pinned loop
    -- A missing signature is a failure, not a pass: renaming one of these would
    -- otherwise empty the check while leaving it green, which is the failure
    -- mode that makes an assertion worse than none.
    if pg_catalog.to_regprocedure(target) is null then
      raise exception 'brand lifecycle function % is missing; this assertion no longer covers it', target;
    end if;
    if not exists (
      select 1
        from pg_catalog.pg_proc proc,
             unnest(coalesce(proc.proconfig, '{}')) as entry
       where proc.oid = pg_catalog.to_regprocedure(target)
         and pg_catalog.split_part(entry, '=', 1) = 'search_path'
         and pg_catalog.btrim(pg_catalog.split_part(entry, '=', 2), '"') = ''
    ) then
      -- For the three claim helpers this is the pin 20260824072313 swept across
      -- schema app, which none of them carries in its own DDL. CREATE OR
      -- REPLACE clears proconfig, so an edit that omits the clause strips it
      -- invisibly -- what went missing is not in the diff. 20260830002000
      -- guards exactly this for jwt_brand_id and jwt_location_ids; these were
      -- uncovered until now.
      raise exception 'brand lifecycle function % does not have an empty search_path pinned', target;
    end if;
  end loop;

  -- The status read and both writers additionally have to be definers; the
  -- three claim helpers must stay invoker, since a definer claim helper would
  -- read the JWT of the wrong role.
  if exists (
    select 1 from pg_catalog.pg_proc proc
    where proc.oid in (
        'app.brand_is_active(uuid)'::regprocedure,
        'public.suspend_brand(uuid, text)'::regprocedure,
        'public.restore_brand(uuid)'::regprocedure)
      and not proc.prosecdef
  ) then raise exception 'the status read or a lifecycle writer is no longer security definer'; end if;
  if exists (
    select 1 from pg_catalog.pg_proc proc
    where proc.oid in (
        'app.is_brand_staff(uuid)'::regprocedure,
        'app.is_brand_owner(uuid)'::regprocedure,
        'app.at_location(uuid, uuid)'::regprocedure)
      and proc.prosecdef
  ) then raise exception 'a claim helper became security definer, so it reads the wrong role''s claims'; end if;
  if not pg_catalog.has_function_privilege('anon', 'app.brand_is_active(uuid)', 'execute')
     or not pg_catalog.has_function_privilege('authenticated', 'app.brand_is_active(uuid)', 'execute') then
    raise exception 'a client role cannot execute app.brand_is_active, so policy evaluation will raise 42501 instead of denying';
  end if;

  -- 4. All three claim helpers consult it. Any one of them losing the conjunct
  --    leaves a whole class of policy open at a suspended brand -- at_location
  --    alone is the operator app's entire surface. Existence is checked first
  --    so a dropped or re-typed helper fails by name rather than by a bare
  --    cast error from pg_get_functiondef.
  if pg_catalog.to_regprocedure('app.is_brand_staff(uuid)') is null
     or pg_catalog.to_regprocedure('app.is_brand_owner(uuid)') is null
     or pg_catalog.to_regprocedure('app.at_location(uuid, uuid)') is null then
    raise exception 'a claim helper is missing or no longer has its documented signature';
  end if;
  if pg_catalog.pg_get_functiondef('app.is_brand_staff(uuid)'::regprocedure)
       not like '%brand_is_active%'
     or pg_catalog.pg_get_functiondef('app.is_brand_owner(uuid)'::regprocedure)
       not like '%brand_is_active%'
     or pg_catalog.pg_get_functiondef('app.at_location(uuid, uuid)'::regprocedure)
       not like '%brand_is_active%' then
    raise exception 'a claim helper no longer consults brand status, so suspension does not reach its policies';
  end if;

  -- 5. is_platform_admin still short-circuits. If the status check ever moves
  --    ahead of it, a platform admin loses the brand they just suspended: no
  --    restore, no audit read, no administration of the separation.
  staff_body := pg_catalog.pg_get_functiondef('app.is_brand_staff(uuid)'::regprocedure);
  admin_at := pg_catalog.strpos(staff_body, 'is_platform_admin');
  status_at := pg_catalog.strpos(staff_body, 'brand_is_active');
  if admin_at = 0 or status_at = 0 or admin_at > status_at then
    raise exception 'app.is_brand_staff no longer tests app.is_platform_admin ahead of brand status';
  end if;
  if pg_catalog.strpos(
       pg_catalog.pg_get_functiondef('app.is_brand_owner(uuid)'::regprocedure),
       'is_platform_admin') = 0 then
    raise exception 'app.is_brand_owner no longer admits a platform admin';
  end if;

  -- 6. The writers exist with the caller-identity signature, are definers with
  --    a pinned search path, and are not reachable by anon.
  if pg_catalog.to_regprocedure('public.suspend_brand(uuid, text)') is null
     or pg_catalog.to_regprocedure('public.restore_brand(uuid)') is null then
    raise exception 'a brand lifecycle writer is missing';
  end if;
  if pg_catalog.has_function_privilege('anon', 'public.suspend_brand(uuid, text)', 'execute')
     or pg_catalog.has_function_privilege('anon', 'public.restore_brand(uuid)', 'execute') then
    raise exception 'anon can suspend or restore a brand';
  end if;

  -- 7. Neither writer grew an actor argument. 20260904000000's invariant is
  --    that an argument-identity writer stays service-only; these are granted
  --    to authenticated, so the identity must keep coming from auth.uid().
  --    Asserted by signature, because adding p_actor_id is how the mistake
  --    would arrive and an overload would still leave the two-argument form in
  --    place to satisfy check 6.
  if pg_catalog.to_regprocedure('public.suspend_brand(uuid, text, uuid)') is not null
     or pg_catalog.to_regprocedure('public.restore_brand(uuid, uuid)') is not null then
    raise exception 'a brand lifecycle writer grew an actor argument; it must resolve auth.uid() in the body';
  end if;
  if pg_catalog.pg_get_functiondef('public.suspend_brand(uuid, text)'::regprocedure)
       not like '%auth.uid()%'
     or pg_catalog.pg_get_functiondef('public.restore_brand(uuid)'::regprocedure)
       not like '%auth.uid()%' then
    raise exception 'a brand lifecycle writer no longer resolves its actor from auth.uid()';
  end if;
end $$;

revoke all on function app.assert_brand_lifecycle_suspension()
  from public, anon, authenticated;
grant execute on function app.assert_brand_lifecycle_suspension() to service_role;

select app.register_release(
  '20260904020000',
  'a brand can be suspended before it is deleted: brands.status gates the three claim helpers through a definer status read, and platform_admin-only suspend/restore writers revoke every device and delegated grant in one transaction',
  'app.assert_brand_lifecycle_suspension()'::regprocedure
);
