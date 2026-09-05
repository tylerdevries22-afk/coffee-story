begin;
create extension if not exists pgtap with schema extensions;
set search_path = extensions, public, pg_catalog;
select plan(12);

select has_view('public', 'activity_board_items', 'activity board uses a narrow view');
select ok(has_table_privilege('authenticated', 'public.activity_board_items', 'SELECT'),
  'paired authenticated displays can read the projection');
select ok(not has_table_privilege('authenticated', 'public.activity_board_items',
  'INSERT,UPDATE,DELETE'), 'the projection is read-only');
select hasnt_column('public', 'activity_board_items', 'template_snapshot',
  'checklist snapshots never reach the wall');
select hasnt_column('public', 'activity_board_items', 'completion_note',
  'completion notes never reach the wall');
select hasnt_column('public', 'activity_board_items', 'claimed_by',
  'staff identifiers never reach the wall');

insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'actor@activity.test');
insert into public.brands (id, slug, name, brand_config) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'activity-a', 'Activity A',
    '{"board":{"mode":"activity"}}');
insert into public.locations (id, brand_id, name) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'North'),
  ('aaaaaaaa-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'South');
insert into public.devices (id, brand_id, location_id, role, paired_at) values
  ('aaaaaaaa-9000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'aaaaaaaa-0000-4000-8000-000000000001', 'display', now());
insert into public.brand_users (id, user_id, brand_id, role, display_name) values
  ('aaaaaaaa-8000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'staff', 'Maya Chen');
insert into public.workforce_roles (id, brand_id, slug, name) values
  ('aaaaaaaa-7000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'general-contractor', 'General Contractor');
insert into public.operation_task_templates (
  id, brand_id, template_key, program_key, title, required_role_ids
) values (
  'aaaaaaaa-6000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'site-check', 'field', 'Site check',
  array['aaaaaaaa-7000-4000-8000-000000000001'::uuid]
);
insert into public.operation_occurrences (
  id, brand_id, location_id, template_id, source, materialization_key,
  template_snapshot, scheduled_for, due_at, status, claimed_by, claimed_at
) values
  ('aaaaaaaa-5000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   'aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-6000-4000-8000-000000000001',
   'manual', 'activity:north',
   '{"programKey":"field","routineKind":"ad_hoc","title":"Site check","steps":[],"requiredRoleIds":["aaaaaaaa-7000-4000-8000-000000000001"],"requiredCompetencyKeys":[]}',
   now(), now() + interval '30 minutes', 'claimed',
   'aaaaaaaa-8000-4000-8000-000000000001', now()),
  ('aaaaaaaa-5000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   'aaaaaaaa-0000-4000-8000-000000000002', 'aaaaaaaa-6000-4000-8000-000000000001',
   'manual', 'activity:south',
   '{"programKey":"field","routineKind":"ad_hoc","title":"Private south task","steps":[],"requiredRoleIds":[],"requiredCompetencyKeys":[]}',
   now(), now() + interval '30 minutes', 'scheduled', null, null);
insert into public.operations_change_signals (location_id, brand_id) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  ('aaaaaaaa-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
on conflict (location_id) do nothing;

set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object(
  'role', 'authenticated',
  'app_metadata', jsonb_build_object(
    'brand_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'device_id', 'aaaaaaaa-9000-4000-8000-000000000001',
    'device_role', 'display',
    'device_location_id', 'aaaaaaaa-0000-4000-8000-000000000001',
    'device_token_version', 1
  )
)::text, true);

select results_eq($test$select title from public.activity_board_items$test$,
  array['Site check']::text[], 'a display sees only its paired location');
select is((select audience_labels from public.activity_board_items),
  array['General Contractor']::text[], 'the safe projection names the task audience');
select results_eq($test$select actor_name from public.activity_board_items$test$,
  array['Maya Chen']::text[], 'the public actor name supports the initials avatar');
select is_empty($test$select id from public.operation_occurrences$test$,
  'the device still cannot read private occurrence rows');
select results_eq($test$select location_id from public.operations_change_signals$test$,
  array['aaaaaaaa-0000-4000-8000-000000000001'::uuid],
  'realtime exposes only the paired location signal');

reset role;
select lives_ok($test$select 1 from public.activity_board_items where false$test$,
  'the projection remains queryable by the database owner');
select * from finish();
rollback;
