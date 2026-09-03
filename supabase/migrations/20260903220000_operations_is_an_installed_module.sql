-- Phase 2.6b: operations becomes a capability a tenant installs, not a column
-- somebody set.
--
-- `brands.operations` has been the operations authorization root since
-- 20260828051242. 20260903170000 made module_installations the authorization
-- root for the platform, which leaves two answers to one question -- and the
-- boolean is the one no other subsystem agrees with. The HQ console already
-- resolves `workforce-operations` through apps/hq/lib/capabilities.ts, the
-- storefront resolves capability through the anon projection, and only the
-- operations runtime still asks the column. A tenant whose installation is
-- suspended keeps every operations grant it ever had, because suspending an
-- installation does not touch a boolean on another table.
--
-- The whole cutover is one function body. app.brand_operations_enabled is the
-- indirection 36 call sites already go through, so redefining it moves every
-- policy, every RPC boundary and every job at once. What this migration adds
-- to that is the eight functions that reached past the indirection and joined
-- public.brands inline; those are the sites a rewrite of the helper alone
-- would have left behind, silently keyed to the old column.
--
-- Not done here, deliberately: dropping brands.operations. The column is still
-- written by scripts/onboard.ts and still read by the backfill parity
-- assertion registered at 20260902220257, which is what makes this migration
-- safe -- every brand with the flag set already has an active
-- workforce-operations installation, and a release where that is untrue fails
-- the gate rather than quietly revoking a tenant's shift board. Removing the
-- column is phase 2.8, after the writer goes.
--
-- Security definer, and why the helper does NOT become one. The helper is
-- `stable` security invoker and stays that way. Read as `authenticated` from
-- an RLS policy it now needs module_installations_select
-- (`app.is_brand_staff(brand_id)`) where it used to need brands_select
-- (`app.is_platform_admin() or app.is_brand_staff(id)`) -- and those two are
-- the same predicate, because is_brand_staff already admits a platform admin
-- and resolves from JWT claims rather than from a brand_users row. So no
-- caller loses access. Making it definer instead would have to carry its own
-- guard, since it takes an arbitrary target_brand and is executable by
-- `authenticated`, and the only guard available -- is_brand_staff -- answers
-- false for service_role, which has no claims. That would have left the three
-- scheduler jobs below authorized to run and materializing nothing. A gate
-- that fails by doing no work is worse than the drift being fixed here.
--
-- The five app.operation_* predicates are already security definer, so the
-- helper called from inside them runs as the function owner and reads
-- module_installations without RLS applying at all; the three job functions
-- run as service_role, which bypasses RLS. RLS on module_installations
-- therefore gates exactly one path -- a direct call from a policy -- which is
-- the path it gated before. There is no recursion: module_installations_select
-- reads JWT claims and no table.
--
-- Where the helper's argument is a function parameter the call is wrapped in a
-- scalar subselect so the planner evaluates it once per statement instead of
-- once per row; where the argument is a per-row column it cannot be hoisted
-- and is called plainly. No policy is created or replaced by this migration,
-- so the `auth_rls_initplan` shape 20260902144208 established is untouched.
--
-- Locks and volume. Every statement here is CREATE OR REPLACE FUNCTION, which
-- takes ACCESS EXCLUSIVE on pg_proc rows only -- no table is read, rewritten
-- or scanned, and no index is built. Nine functions at single-digit
-- milliseconds total. The largest deployment holds one module_installations
-- row per (brand, module) and one brands row per tenant: tens of rows. The
-- per-row cost the helper now pays is an index lookup on
-- module_installations_brand_module_key (unique on (brand_id, module_key))
-- in place of a primary-key lookup on public.brands.

-- 1. The indirection ------------------------------------------------------

-- `exists` rather than the coalesced scalar subselect this replaced: an
-- installation either is active or is not, so there is no third answer to
-- collapse and nothing for a null to leak through. 'active' is named
-- explicitly because it is the only state that grants -- 'draft',
-- 'validating', 'suspended', 'error' and 'disabled' must all read as off, and
-- `state <> 'disabled'` is how a suspended tenant keeps its access.
--
-- No join to app.module_registry. 20260903170000 constrained module_key with
-- a foreign key to it, so an installation naming this key is necessarily
-- governed by the registry entry and re-checking it would only add a lookup.
create or replace function app.brand_operations_enabled(target_brand uuid)
returns boolean language sql stable set search_path = '' as $$
  select exists (
    select 1 from public.module_installations installation
     where installation.brand_id = target_brand
       and installation.module_key = 'workforce-operations'
       and installation.state = 'active'
  )
$$;
revoke all on function app.brand_operations_enabled(uuid) from public, anon;
grant execute on function app.brand_operations_enabled(uuid) to authenticated, service_role;

comment on function app.brand_operations_enabled(uuid) is
  'Whether a brand may run operations: an active workforce-operations '
  'installation, which replaced brands.operations in 20260903220000. Security '
  'invoker on purpose -- see that migration for why a definer form would '
  'strand the service-role jobs.';

-- 2. The predicates that reached past it ----------------------------------

-- All five joined public.brands inline instead of calling the helper, so all
-- five would have kept reading the column. Reproduced whole rather than
-- patched, and the ordering of the disjunction is load-bearing: the original
-- reads `is_platform_admin() or exists (... and brand.operations)`, so a
-- platform admin answers true whether or not the tenant runs operations. That
-- is preserved exactly -- this migration changes what "runs operations" means
-- and nothing about who may ask.
--
-- The membership read stays a live brand_users lookup for the reason
-- 20260828051242 gave: a custom JWT claim survives a transfer or an offboard
-- and the row does not.
create or replace function app.operation_location_access(
  target_brand uuid,
  target_location uuid
) returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(app.is_platform_admin() or (
    (select app.brand_operations_enabled(target_brand))
    and exists (
      select 1 from public.brand_users member
      where member.brand_id = target_brand and member.user_id = (select auth.uid())
        and (member.role = 'brand_owner' or target_location = any(member.location_ids))
    )
  ), false)
$$;
revoke all on function app.operation_location_access(uuid, uuid) from public, anon;
grant execute on function app.operation_location_access(uuid, uuid) to authenticated, service_role;

create or replace function app.operation_location_manager(
  target_brand uuid,
  target_location uuid
) returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(app.is_platform_admin() or (
    (select app.brand_operations_enabled(target_brand))
    and exists (
      select 1 from public.brand_users member
      where member.brand_id = target_brand and member.user_id = (select auth.uid())
        and (member.role = 'brand_owner'
          or (member.role = 'location_manager' and target_location = any(member.location_ids)))
    )
  ), false)
$$;
revoke all on function app.operation_location_manager(uuid, uuid) from public, anon;
grant execute on function app.operation_location_manager(uuid, uuid) to authenticated, service_role;

create or replace function app.operation_brand_owner(target_brand uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(app.is_platform_admin() or (
    (select app.brand_operations_enabled(target_brand))
    and exists (
      select 1 from public.brand_users member
      where member.brand_id = target_brand and member.user_id = (select auth.uid())
        and member.role = 'brand_owner'
    )
  ), false)
$$;
revoke all on function app.operation_brand_owner(uuid) from public, anon;
grant execute on function app.operation_brand_owner(uuid) to authenticated, service_role;

create or replace function app.operation_brand_staff(target_brand uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(app.is_platform_admin() or (
    (select app.brand_operations_enabled(target_brand))
    and exists (
      select 1 from public.brand_users member
      where member.brand_id = target_brand and member.user_id = (select auth.uid())
    )
  ), false)
$$;
revoke all on function app.operation_brand_staff(uuid) from public, anon;
grant execute on function app.operation_brand_staff(uuid) to authenticated, service_role;

-- The one whose inline join was on the viewer's brand rather than on the
-- argument. `viewer.brand_id = target_brand` is asserted in the same where
-- clause, so hoisting the capability test onto target_brand is the same
-- question asked once instead of once per candidate row.
create or replace function app.operation_manager_can_view_member(
  target_brand uuid,
  target_member uuid
) returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(app.is_platform_admin() or (
    (select app.brand_operations_enabled(target_brand))
    and exists (
      select 1 from public.brand_users viewer
      join public.brand_users subject on subject.brand_id = viewer.brand_id
        and subject.id = target_member
      where viewer.brand_id = target_brand and viewer.user_id = (select auth.uid())
        and (viewer.role = 'brand_owner'
          or (viewer.role = 'location_manager' and viewer.location_ids && subject.location_ids))
    )
  ), false)
$$;
revoke all on function app.operation_manager_can_view_member(uuid, uuid) from public, anon;
grant execute on function app.operation_manager_can_view_member(uuid, uuid)
  to authenticated, service_role;

-- 3. The scheduler --------------------------------------------------------

-- Reproduced from 20260828144328, which is the authoritative definition of
-- this function -- 20260828051242 defined it first and that copy was already
-- superseded by the isolation and lifecycle repairs 0828144328 landed. Anyone
-- reading only the earlier migration would rewrite the dead copy and leave the
-- occurrence materializer, the claim-expiry sweep and the miss job keyed to
-- brands.operations, which is the one failure in this migration that no test
-- of a client session would catch: the jobs run as service_role, report
-- success, and generate nothing.
--
-- Three sites, and each loses its brands lookup rather than gaining one. The
-- materializer's `join public.brands ... and brand.operations` contributed no
-- column to the CTE's select list and existed only to filter, and brand.id is
-- a primary key so the join could never fan a row out; it becomes a predicate.
-- The other two were already `exists` subqueries against the same column.
create or replace function public.run_operation_maintenance(
  target_now timestamptz default now(),
  target_horizon_hours integer default 840
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare generated_count integer := 0; released_count integer := 0;
  missed_count integer := 0;
begin
  if target_horizon_hours not between 1 and 840 then
    raise exception using errcode = '22023', message = 'operation_horizon_invalid';
  end if;
  with schedule_days as (
    select schedule, location.hours, local_day::date service_day
    from public.operation_schedules schedule
    join public.locations location on location.id = schedule.location_id
      and location.brand_id = schedule.brand_id
    cross join lateral generate_series(
      (target_now at time zone schedule.timezone)::date,
      ((target_now + make_interval(hours => target_horizon_hours)) at time zone schedule.timezone)::date,
      interval '1 day'
    ) local_day
    where schedule.is_enabled and local_day::date >= schedule.active_from
      and (schedule.active_until is null or local_day::date <= schedule.active_until)
      and app.brand_operations_enabled(schedule.brand_id)
  ), schedule_windows as (
    select (schedule_day.schedule).*, starts_at
    from schedule_days schedule_day
    cross join lateral app.operation_schedule_starts(
      schedule_day.schedule, schedule_day.hours, schedule_day.service_day
    ) starts_at
  ), inserted as (
    insert into public.operation_occurrences
      (brand_id, location_id, schedule_id, template_id, source, materialization_key,
       template_snapshot, scheduled_for, due_at, grace_minutes, status)
    select schedule_window.brand_id, schedule_window.location_id, schedule_window.id,
      schedule_window.template_id, 'schedule', schedule_window.id::text || ':'
        || floor(extract(epoch from schedule_window.starts_at))::bigint::text,
      app.build_operation_snapshot(schedule_window.template_id), schedule_window.starts_at,
      schedule_window.starts_at + make_interval(mins => schedule_window.due_window_minutes),
      schedule_window.grace_minutes, 'scheduled'
    from schedule_windows schedule_window
    where schedule_window.starts_at <= target_now + make_interval(hours => target_horizon_hours)
    on conflict (brand_id, materialization_key) do nothing returning id, brand_id
  ), events as (
    insert into public.operation_occurrence_events (brand_id, occurrence_id, event_type)
    select inserted.brand_id, inserted.id, 'created' from inserted returning 1
  ) select count(*) into generated_count from inserted;
  with changed as (
    update public.operation_occurrences occurrence set status = 'scheduled', claimed_by = null,
      claimed_at = null, claim_expires_at = null
    where occurrence.status = 'claimed' and occurrence.claim_expires_at <= target_now
      and app.brand_operations_enabled(occurrence.brand_id)
    returning occurrence.id, occurrence.brand_id
  ), events as (
    insert into public.operation_occurrence_events (brand_id, occurrence_id, event_type, reason)
    select changed.brand_id, changed.id, 'released', 'claim_expired' from changed returning 1
  ) select count(*) into released_count from changed;
  with changed as (
    update public.operation_occurrences occurrence set status = 'missed'
    where occurrence.status = 'scheduled' and occurrence.schedule_id is not null
      and app.brand_operations_enabled(occurrence.brand_id)
      and exists (select 1 from public.operation_occurrences successor
        where successor.schedule_id = occurrence.schedule_id
          and successor.scheduled_for > occurrence.scheduled_for
          and successor.scheduled_for <= target_now)
    returning occurrence.id, occurrence.brand_id
  ), events as (
    insert into public.operation_occurrence_events (brand_id, occurrence_id, event_type, reason)
    select changed.brand_id, changed.id, 'missed', 'superseded' from changed returning 1
  ) select count(*) into missed_count from changed;
  return jsonb_build_object('generated', generated_count, 'released', released_count,
    'missed', missed_count, 'outbox', 0);
end $$;
revoke all on function public.run_operation_maintenance(timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.run_operation_maintenance(timestamptz, integer) to service_role;

-- The sole escalation writer since 20260828144328 split it out of maintenance.
-- Its brands join was in the `recipients` CTE and likewise filtered only.
create or replace function public.queue_due_operation_escalations(target_now timestamptz default now())
returns integer language plpgsql security definer set search_path = '' as $$
declare inserted_count integer;
begin
  with recipients as (
    select occurrence.id occurrence_id, occurrence.brand_id, occurrence.location_id,
      rule.id rule_id, member.id recipient_id, channel
    from public.operation_occurrences occurrence
    join public.operation_escalation_rules rule on rule.brand_id = occurrence.brand_id
      and (rule.schedule_id is null or rule.schedule_id = occurrence.schedule_id)
    cross join lateral unnest(rule.channels) channel
    join public.brand_users member on member.brand_id = occurrence.brand_id and (
      (rule.recipient_role = 'brand_owner' and member.role = 'brand_owner')
      or (rule.recipient_role = 'location_manager' and member.role = 'location_manager'
        and occurrence.location_id = any(member.location_ids))
      or (rule.recipient_role = 'eligible_staff' and member.role in ('staff', 'location_manager')
        and occurrence.location_id = any(member.location_ids)
        and app.operation_actor_is_eligible(occurrence, member.id))
    )
    where occurrence.status in ('scheduled', 'claimed', 'missed') and rule.is_active
      and target_now >= occurrence.due_at + make_interval(mins => rule.offset_minutes)
      and app.brand_operations_enabled(occurrence.brand_id)
  ), inserted as (
    insert into public.operation_notification_outbox
      (brand_id, location_id, occurrence_id, escalation_rule_id, recipient_id, channel,
       status, available_at, sent_at)
    select brand_id, location_id, occurrence_id, rule_id, recipient_id, channel,
      case when channel = 'in_app' then 'sent' else 'pending' end,
      target_now, case when channel = 'in_app' then target_now else null end
    from recipients on conflict (occurrence_id, escalation_rule_id, recipient_id, channel) do nothing
    returning *
  ), notifications as (
    insert into public.operation_operator_notifications
      (brand_id, location_id, occurrence_id, recipient_id, outbox_id, notification_kind, title, body)
    select inserted.brand_id, inserted.location_id, inserted.occurrence_id, inserted.recipient_id,
      inserted.id, 'overdue', 'Operation overdue',
      coalesce(occurrence.template_snapshot->>'title', 'Scheduled operation') || ' is overdue.'
    from inserted join public.operation_occurrences occurrence on occurrence.id = inserted.occurrence_id
    where inserted.channel = 'in_app' on conflict (outbox_id) do nothing returning 1
  ) select count(*) into inserted_count from inserted;
  return inserted_count;
end $$;
revoke all on function public.queue_due_operation_escalations(timestamptz)
  from public, anon, authenticated;
grant execute on function public.queue_due_operation_escalations(timestamptz) to service_role;

-- Reproduced from 20260828130000, which superseded the 20260828051242 copy.
-- Both of its sites change shape rather than just their predicate: the cancel
-- pass used public.brands as an UPDATE ... FROM source purely to test the
-- boolean, and the candidates CTE joined it under `for update of outbox`. With
-- the helper neither needs the table in scope, which also removes the only
-- reason a row lock here ever had a second relation to reason about.
--
-- One behavioural edge, stated because it is a change: `not brand.operations`
-- required a brands row to exist, and `not app.brand_operations_enabled(...)`
-- also cancels when no row does. brand_id is a foreign key, so that case is
-- unreachable -- and were it reachable, cancelling delivery for a brand that
-- does not exist is the answer this function should give.
create or replace function public.claim_operation_notification_batch(target_limit integer default 50)
returns setof public.operation_notification_outbox
language plpgsql security definer set search_path = '' as $$
begin
  update public.operation_notification_outbox outbox
    set status = 'cancelled', last_error = 'operations_disabled'
  where not app.brand_operations_enabled(outbox.brand_id)
    and outbox.status in ('pending', 'failed', 'sending');

  return query with candidates as (
    select outbox.id from public.operation_notification_outbox outbox
    where outbox.status in ('pending', 'failed', 'sending')
      and outbox.available_at <= now() and outbox.attempt_count < 20
      and app.brand_operations_enabled(outbox.brand_id)
    order by outbox.available_at, outbox.id
    for update of outbox skip locked limit least(greatest(target_limit, 1), 200)
  )
  update public.operation_notification_outbox outbox set status = 'sending',
    attempt_count = outbox.attempt_count + 1, last_error = null,
    available_at = now() + interval '5 minutes'
  from candidates where outbox.id = candidates.id returning outbox.*;
end
$$;
revoke all on function public.claim_operation_notification_batch(integer)
  from public, anon, authenticated;
grant execute on function public.claim_operation_notification_batch(integer) to service_role;

-- Readiness ----------------------------------------------------------------

-- The cutover is nine function bodies, and a function body is the easiest
-- thing in a schema to revert by accident: any later migration that reproduces
-- one of these from an older copy -- which is exactly how 20260828051242's
-- dead run_operation_maintenance nearly took this change down -- would restore
-- the column read with no error anywhere. So the assertion is stated against
-- the bodies themselves rather than against a catalog fact, because there is
-- no catalog fact that distinguishes the two versions.
create or replace function app.assert_operations_is_an_installed_module()
returns void language plpgsql stable security invoker set search_path = '' as $$
declare
  target text;
  body text;
begin
  if pg_catalog.to_regprocedure('app.brand_operations_enabled(uuid)') is null then
    raise exception 'the operations capability helper is missing';
  end if;

  body := pg_catalog.pg_get_functiondef('app.brand_operations_enabled(uuid)'::regprocedure);
  if body !~ 'public\.module_installations'
     or body !~ '''workforce-operations'''
     or body !~ 'installation\.state = ''active''' then
    raise exception 'the operations capability helper no longer resolves an active installation';
  end if;
  -- The definer decision, pinned. A definer form of this function takes an
  -- arbitrary brand and is executable by `authenticated`, which makes it a
  -- cross-tenant capability oracle unless it carries its own guard -- and the
  -- only guard available answers false for the service-role jobs. Neither
  -- outcome may arrive quietly.
  if exists (
    select 1 from pg_catalog.pg_proc proc
    where proc.oid = 'app.brand_operations_enabled(uuid)'::regprocedure and proc.prosecdef
  ) then raise exception 'the operations capability helper became security definer'; end if;
  if pg_catalog.has_function_privilege('anon', 'app.brand_operations_enabled(uuid)', 'execute') then
    raise exception 'anon can resolve the operations capability';
  end if;

  -- The eight that reached past the helper. Naming them individually rather
  -- than scanning pg_proc for the pattern: a list that has to be edited is a
  -- list somebody reads, and the three job functions are the ones whose
  -- regression produces no error at all.
  foreach target in array array[
    'app.operation_location_access(uuid, uuid)',
    'app.operation_location_manager(uuid, uuid)',
    'app.operation_brand_owner(uuid)',
    'app.operation_brand_staff(uuid)',
    'app.operation_manager_can_view_member(uuid, uuid)',
    'public.run_operation_maintenance(timestamptz, integer)',
    'public.queue_due_operation_escalations(timestamptz)',
    'public.claim_operation_notification_batch(integer)'
  ] loop
    if pg_catalog.to_regprocedure(target) is null then
      raise exception 'operations function % is missing', target;
    end if;
    body := pg_catalog.pg_get_functiondef(target::regprocedure);
    if body ~ 'brand\.operations' then
      raise exception 'operations function % reads the legacy brands.operations column again', target;
    end if;
    if body !~ 'brand_operations_enabled' then
      raise exception 'operations function % stopped resolving capability through the helper', target;
    end if;
  end loop;

  -- The one path where RLS still decides the helper's answer: a call made as
  -- `authenticated` from a policy clause. It is equivalent to the brands_select
  -- it replaced only while this policy stays keyed to app.is_brand_staff, so a
  -- narrowing of it would revoke operations for brand staff with no other
  -- signal than the shift board going empty.
  if not exists (
    select 1 from pg_catalog.pg_policies policy
    where policy.schemaname = 'public' and policy.tablename = 'module_installations'
      and policy.policyname = 'module_installations_select'
      and policy.qual like '%is_brand_staff%'
  ) then raise exception 'module_installations_select no longer admits brand staff'; end if;

  -- The key the helper names has to be one the registry governs, or the
  -- capability is unreachable for every tenant.
  if not exists (
    select 1 from app.module_registry where module_key = 'workforce-operations'
  ) then raise exception 'the registry no longer governs workforce-operations'; end if;
end $$;

revoke all on function app.assert_operations_is_an_installed_module()
  from public, anon, authenticated;
grant execute on function app.assert_operations_is_an_installed_module() to service_role;

select app.register_release(
  '20260903220000',
  'operations is gated by an active workforce-operations installation rather than by brands.operations; the helper and the eight functions that joined the column inline now resolve through module_installations',
  'app.assert_operations_is_an_installed_module()'::regprocedure
);
