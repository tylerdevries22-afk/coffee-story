begin;
create extension if not exists pgtap with schema extensions;
set search_path = extensions, public, pg_catalog;
select plan(9);

select ok(not has_function_privilege(
  'anon', 'public.advance_due_drop_batch(timestamptz,integer)', 'EXECUTE'
), 'anonymous callers cannot advance drops');
select ok(not has_function_privilege(
  'authenticated', 'public.advance_due_drop_batch(timestamptz,integer)', 'EXECUTE'
), 'authenticated callers cannot advance drops');
select ok(has_function_privilege(
  'service_role', 'public.advance_due_drop_batch(timestamptz,integer)', 'EXECUTE'
), 'the service worker can advance drops');

insert into public.brands (id, slug, name) values
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'drop-transitions', 'Drop Transitions');
insert into public.menus (id, brand_id, name) values
  ('eeeeeeee-1000-4000-8000-000000000001',
   'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'Drop transitions');
insert into public.menu_categories (id, brand_id, menu_id, title) values
  ('eeeeeeee-2000-4000-8000-000000000001',
   'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
   'eeeeeeee-1000-4000-8000-000000000001', 'Drops');
insert into public.menu_items (
  id, brand_id, menu_id, category_id, slug, name, base_price_cents
) values (
  'eeeeeeee-3000-4000-8000-000000000001',
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  'eeeeeeee-1000-4000-8000-000000000001',
  'eeeeeeee-2000-4000-8000-000000000001',
  'transition-latte', 'Transition latte', 500
);
insert into public.drops (
  id, brand_id, item_id, reveal_at, starts_at, ends_at, status
) values
  ('eeeeeeee-4000-4000-8000-000000000001',
   'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
   'eeeeeeee-3000-4000-8000-000000000001',
   '2030-01-02', '2030-01-03', '2030-01-04', 'scheduled'),
  ('eeeeeeee-4000-4000-8000-000000000002',
   'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
   'eeeeeeee-3000-4000-8000-000000000001',
   '2029-12-31', '2030-01-03', '2030-01-04', 'scheduled'),
  ('eeeeeeee-4000-4000-8000-000000000003',
   'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
   'eeeeeeee-3000-4000-8000-000000000001',
   '2029-12-30', '2029-12-31', '2030-01-03', 'scheduled'),
  ('eeeeeeee-4000-4000-8000-000000000004',
   'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
   'eeeeeeee-3000-4000-8000-000000000001',
   '2029-12-29', '2029-12-30', '2029-12-31', 'scheduled'),
  ('eeeeeeee-4000-4000-8000-000000000005',
   'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
   null, '2029-12-30', '2029-12-31', 'cancelled');

set local role service_role;
select results_eq($test$
  select id, from_status, to_status
  from public.advance_due_drop_batch('2030-01-01', 200)
  order by id
$test$, $expected$
  values
    ('eeeeeeee-4000-4000-8000-000000000002'::uuid, 'scheduled'::text, 'revealed'::text),
    ('eeeeeeee-4000-4000-8000-000000000003'::uuid, 'scheduled'::text, 'live'::text),
    ('eeeeeeee-4000-4000-8000-000000000004'::uuid, 'scheduled'::text, 'ended'::text)
$expected$, 'one batch applies reveal, live, and ended priority');
select is((select status from public.drops
  where id = 'eeeeeeee-4000-4000-8000-000000000001'), 'scheduled',
  'a future drop is untouched');
select is((select status from public.drops
  where id = 'eeeeeeee-4000-4000-8000-000000000005'), 'cancelled',
  'a cancelled drop is untouched');
select is_empty($test$
  select id from public.advance_due_drop_batch('2030-01-01', 200)
$test$, 'repeating the batch is idempotent');

insert into public.drops (brand_id, item_id, reveal_at, starts_at, ends_at, status)
select
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  'eeeeeeee-3000-4000-8000-000000000001',
  '2029-12-31', '2030-01-03', '2030-01-04', 'scheduled'
from generate_series(1, 201);
select is((select count(*) from public.advance_due_drop_batch('2030-01-01', 200)),
  200::bigint, 'the batch enforces its 200-row bound');
select is((select count(*) from public.advance_due_drop_batch('2030-01-01', 200)),
  1::bigint, 'a later batch drains the remaining due row');
reset role;

select * from finish();
rollback;
