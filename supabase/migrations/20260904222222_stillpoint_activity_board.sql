-- A public wall may show project activity, but never checklist instructions,
-- completion notes, evidence, issues, user ids, or the underlying occurrence.
-- This definer projection is the complete privilege boundary for that screen.
create view public.activity_board_items
with (security_barrier = true) as
  select occurrence.id,
         occurrence.brand_id,
         occurrence.location_id,
         left(occurrence.template_snapshot->>'title', 200) as title,
         array(
           select role.name
             from jsonb_array_elements_text(
               coalesce(occurrence.template_snapshot->'requiredRoleIds', '[]'::jsonb)
             ) role_id
             join public.workforce_roles role
               on role.id::text = role_id.value
              and role.brand_id = occurrence.brand_id
            order by role.sort_order, role.name
         ) as audience_labels,
         occurrence.status,
         occurrence.scheduled_for,
         occurrence.due_at,
         nullif(btrim(actor.display_name), '') as actor_name,
         occurrence.updated_at
    from public.operation_occurrences occurrence
    join public.brands brand on brand.id = occurrence.brand_id
    left join public.brand_users actor
      on actor.id = occurrence.claimed_by
     and actor.brand_id = occurrence.brand_id
   where brand.brand_config #>> '{board,mode}' = 'activity'
     and occurrence.status in ('scheduled', 'claimed', 'completed')
     and (occurrence.status <> 'completed'
       or occurrence.completed_at > now() - interval '12 hours')
     and app.can_read_board(occurrence.brand_id, occurrence.location_id);

revoke all on public.activity_board_items from public, anon, authenticated;
revoke insert, update, delete on public.activity_board_items from anon, authenticated;
grant select on public.activity_board_items to authenticated;

comment on view public.activity_board_items is
  'Display-safe live operations projection. Omits instructions, notes, evidence, '
  'issues, user ids, and checklist responses; access is gated by can_read_board.';

-- The signal is payload-free. A paired display learns only that its own
-- location changed, then reconciles through activity_board_items.
drop policy operations_change_signals_read on public.operations_change_signals;
create policy operations_change_signals_read
  on public.operations_change_signals for select to authenticated
  using (
    app.operation_location_access(brand_id, location_id)
    or app.can_read_board(brand_id, location_id)
  );

create or replace function app.assert_activity_board_security()
returns void language plpgsql stable security invoker set search_path = '' as $$
begin
  if pg_catalog.to_regclass('public.activity_board_items') is null then
    raise exception 'activity board projection is missing';
  end if;
  if not pg_catalog.has_table_privilege(
       'authenticated', 'public.activity_board_items', 'select')
     or pg_catalog.has_table_privilege(
       'authenticated', 'public.activity_board_items', 'insert,update,delete')
     or pg_catalog.has_table_privilege(
       'anon', 'public.activity_board_items', 'select,insert,update,delete') then
    raise exception 'activity board projection grants are unsafe';
  end if;
  if exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'activity_board_items'
       and column_name in (
         'template_snapshot', 'completion_note', 'claimed_by',
         'completed_by', 'completion_responses'
       )
  ) then
    raise exception 'activity board projection exposes private operation data';
  end if;
  if not exists (
    select 1
      from pg_catalog.pg_policy policy
     where policy.polrelid = 'public.operations_change_signals'::regclass
       and policy.polname = 'operations_change_signals_read'
       and policy.polroles @> array[
         (select oid from pg_catalog.pg_roles where rolname = 'authenticated')
       ]::oid[]
  ) then
    raise exception 'activity board realtime signal policy is missing';
  end if;
end $$;

revoke all on function app.assert_activity_board_security()
  from public, anon, authenticated;
grant execute on function app.assert_activity_board_security() to service_role;

select app.register_release(
  '20260904222222',
  'tenant activity boards expose a location-scoped safe projection and payload-free realtime signal',
  'app.assert_activity_board_security()'::regprocedure
);
