-- Fifty-one foreign keys had no index behind them.
--
-- Postgres enforces a foreign key by reading the child. Deleting a location,
-- retiring a task template, removing a staff member -- each one asks every
-- table that references it "do you still point at this?", and a table with no
-- covering index answers with a sequential scan. One shop with one location and
-- a few hundred operational rows never notices. A franchise does: the scans are
-- per referencing table, per parent row, inside the deleting transaction, and
-- they grow with the whole platform's data rather than with the tenant doing
-- the work. Closing a single location on a hundred-brand platform would read
-- every operations row on it.
--
-- The same indexes are the ones RLS wants. Every gap below leads with a tenant
-- column -- `brand_id`, or `(location_id, brand_id)` -- because that is how the
-- schema keys its references, so a table that had no covering index for its
-- foreign key also had nothing to seek on for the policy that scopes it. Eleven
-- of these tables had no index leading with `brand_id` at all.
--
-- Column order follows the constraint rather than being tidied, so a reader can
-- match each index to the key it covers by name. Order does not actually matter
-- to the planner here -- an index whose leading columns are the key's columns
-- in any order serves the equality lookup the check issues -- which is why six
-- constraints Supabase's advisor reports as unindexed are absent from this
-- list: `operation_staff_devices (brand_user_id, brand_id)` is already served
-- by `(brand_id, brand_user_id, last_action_id)`, and five others likewise. The
-- readiness assertion at the bottom uses the set test, not the advisor's
-- stricter ordered one, so it does not demand redundant indexes.

create index if not exists catalogs_template_id_idx
  on public.catalogs (template_id);

create index if not exists industry_blueprints_created_by_idx
  on public.industry_blueprints (created_by);

-- Self-referencing: deleting one category scans the whole tree for children.
create index if not exists menu_categories_parent_id_idx
  on public.menu_categories (parent_id);
create index if not exists menu_categories_parent_tenant_idx
  on public.menu_categories (parent_id, menu_id, brand_id);

create index if not exists operation_action_receipts_location_id_brand_id_idx
  on public.operation_action_receipts (location_id, brand_id);
create index if not exists operation_action_receipts_occurrence_id_brand_id_location__idx
  on public.operation_action_receipts (occurrence_id, brand_id, location_id);

create index if not exists operation_issues_brand_id_idx
  on public.operation_issues (brand_id);
create index if not exists operation_issues_location_id_brand_id_idx
  on public.operation_issues (location_id, brand_id);
create index if not exists operation_issues_occurrence_brand_location_idx
  on public.operation_issues (occurrence_id, brand_id, location_id);
create index if not exists operation_issues_reported_by_brand_idx
  on public.operation_issues (reported_by, brand_id);
create index if not exists operation_issues_resolved_by_brand_id_idx
  on public.operation_issues (resolved_by, brand_id);

create index if not exists operation_notification_outbox_brand_id_idx
  on public.operation_notification_outbox (brand_id);
create index if not exists operation_notification_outbox_location_id_brand_id_idx
  on public.operation_notification_outbox (location_id, brand_id);
create index if not exists operation_notification_outbox_recipient_id_brand_id_idx
  on public.operation_notification_outbox (recipient_id, brand_id);
create index if not exists operation_outbox_escalation_brand_idx
  on public.operation_notification_outbox (escalation_rule_id, brand_id);
create index if not exists operation_outbox_occurrence_brand_location_idx
  on public.operation_notification_outbox (occurrence_id, brand_id, location_id);

create index if not exists operation_occurrence_events_actor_id_brand_id_idx
  on public.operation_occurrence_events (actor_id, brand_id);
create index if not exists operation_occurrence_events_brand_id_idx
  on public.operation_occurrence_events (brand_id);
create index if not exists operation_occurrence_events_occurrence_id_brand_id_idx
  on public.operation_occurrence_events (occurrence_id, brand_id);

create index if not exists operation_occurrences_claimed_by_brand_id_idx
  on public.operation_occurrences (claimed_by, brand_id);
create index if not exists operation_occurrences_location_id_brand_id_idx
  on public.operation_occurrences (location_id, brand_id);
create index if not exists operation_occurrences_schedule_id_brand_id_idx
  on public.operation_occurrences (schedule_id, brand_id);
create index if not exists operation_occurrences_template_id_brand_id_idx
  on public.operation_occurrences (template_id, brand_id);

create index if not exists operation_operator_notificati_occurrence_id_brand_id_locat_idx
  on public.operation_operator_notifications (occurrence_id, brand_id, location_id);
create index if not exists operation_operator_notifications_location_id_brand_id_idx
  on public.operation_operator_notifications (location_id, brand_id);

create index if not exists operation_retention_policies_updated_by_brand_id_idx
  on public.operation_retention_policies (updated_by, brand_id);

create index if not exists operation_schedules_created_by_brand_id_idx
  on public.operation_schedules (created_by, brand_id);
create index if not exists operation_schedules_template_id_brand_id_idx
  on public.operation_schedules (template_id, brand_id);

create index if not exists operation_responses_responded_by_brand_idx
  on public.operation_step_responses (responded_by, brand_id);
create index if not exists operation_step_responses_brand_id_idx
  on public.operation_step_responses (brand_id);
create index if not exists operation_step_responses_occurrence_id_brand_id_idx
  on public.operation_step_responses (occurrence_id, brand_id);

create index if not exists operation_task_steps_brand_id_idx
  on public.operation_task_steps (brand_id);
create index if not exists operation_task_steps_template_id_brand_id_idx
  on public.operation_task_steps (template_id, brand_id);

create index if not exists operation_task_templates_brand_template_id_brand_id_idx
  on public.operation_task_templates (brand_template_id, brand_id);
create index if not exists operation_task_templates_created_by_brand_id_idx
  on public.operation_task_templates (created_by, brand_id);

create index if not exists operations_change_signals_brand_id_idx
  on public.operations_change_signals (brand_id);
create index if not exists operations_change_signals_location_id_brand_id_idx
  on public.operations_change_signals (location_id, brand_id);

create index if not exists platform_automation_policies_authorized_by_idx
  on public.platform_automation_policies (authorized_by);

create index if not exists platform_billing_accounts_rate_plan_id_idx
  on public.platform_billing_accounts (rate_plan_id);

create index if not exists platform_factory_audit_events_actor_id_idx
  on public.platform_factory_audit_events (actor_id);

create index if not exists platform_onboarding_runs_created_by_idx
  on public.platform_onboarding_runs (created_by);
create index if not exists platform_onboarding_runs_industry_blueprint_id_idx
  on public.platform_onboarding_runs (industry_blueprint_id);

create index if not exists prep_batches_recipe_id_idx
  on public.prep_batches (recipe_id, brand_id);

create index if not exists recipes_menu_item_id_idx
  on public.recipes (menu_item_id, brand_id);

create index if not exists shifts_location_brand_idx
  on public.shifts (location_id, brand_id);
create index if not exists shifts_member_brand_idx
  on public.shifts (brand_user_id, brand_id);

create index if not exists training_awards_competency_brand_idx
  on public.training_competency_awards (competency_id, brand_id);
create index if not exists training_awards_revoker_brand_idx
  on public.training_competency_awards (revoked_by, brand_id);
create index if not exists training_competency_awards_awarded_by_brand_id_idx
  on public.training_competency_awards (awarded_by, brand_id);
create index if not exists training_competency_awards_brand_user_id_brand_id_idx
  on public.training_competency_awards (brand_user_id, brand_id);
create index if not exists training_competency_awards_release_id_brand_id_idx
  on public.training_competency_awards (release_id, brand_id);

-- ---------------------------------------------------------------------------
-- The release contract

-- The gate is derived from the newest migration filename, so every migration
-- extends the chain or the release fails closed against a version nothing
-- returns.
--
-- This link asserts the property rather than the fifty-one names, so it keeps
-- holding as the schema grows: a later migration that adds a foreign key and
-- forgets its index fails the gate with the constraint named, which is the only
-- way this defect stays fixed. Fifty-one accumulated because nothing was
-- watching, not because anyone decided against them.
--
-- Set equality, not ordered prefix equality: `(brand_id, brand_user_id, ...)`
-- serves a key on `(brand_user_id, brand_id)` because the check issues equality
-- on every key column at once. Demanding the constraint's own order would ask
-- for indexes that duplicate ones already there.
--
-- Partitions are skipped: they inherit both the key and the parent's index, and
-- counting them would report the same gap once per month of analytics.

alter function public.platform_release_readiness()
  rename to platform_release_readiness_20260830010000;
alter function public.platform_release_readiness_20260830010000() set schema app;
revoke all on function app.platform_release_readiness_20260830010000()
  from public, anon, authenticated;
grant execute on function app.platform_release_readiness_20260830010000()
  to service_role;

create or replace function public.platform_release_readiness()
returns text language plpgsql stable security invoker set search_path = '' as $$
declare uncovered text;
begin
  if app.platform_release_readiness_20260830010000() <> '20260830010000' then
    raise exception 'tenant earn rate readiness prerequisite is incomplete';
  end if;

  select c.conrelid::regclass::text || ' ' || c.conname
    into uncovered
    from pg_catalog.pg_constraint c
    join pg_catalog.pg_class t on t.oid = c.conrelid
    join pg_catalog.pg_namespace n on n.oid = t.relnamespace
   where c.contype = 'f'
     and n.nspname = 'public'
     and not t.relispartition
     and not exists (
       select 1
         from pg_catalog.pg_index i
        where i.indrelid = c.conrelid
          and i.indnkeyatts >= array_length(c.conkey, 1)
          and (
            select array_agg(column_number order by column_number)
              from unnest((i.indkey::int2[])[0:array_length(c.conkey, 1) - 1]) column_number
          ) = (
            select array_agg(column_number order by column_number)
              from unnest(c.conkey) column_number
          )
     )
   order by 1
   limit 1;
  if uncovered is not null then
    raise exception 'foreign key % has no covering index, so its parent cannot be deleted without a sequential scan', uncovered;
  end if;

  return '20260830020000';
end $$;
revoke all on function public.platform_release_readiness()
  from public, anon, authenticated;
grant execute on function public.platform_release_readiness()
  to service_role;
