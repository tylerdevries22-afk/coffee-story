begin;
create extension if not exists pgtap with schema extensions;
-- dblink is created by migrations; recreating it re-runs Supabase's
-- after-create hook, which revokes dblink_connect_u from postgres.
set search_path = extensions, public, pg_catalog;
select plan(5);

select dblink_connect_u('drop_worker_a', format('dbname=%s', current_database()));
select dblink_connect_u('drop_worker_b', format('dbname=%s', current_database()));

select dblink_exec('drop_worker_b', $setup$
  create table if not exists public.drop_transition_concurrency_results (
    worker text primary key,
    drop_id uuid not null
  );
  truncate public.drop_transition_concurrency_results;
  set session_replication_role = replica;
  delete from public.catalog_nodes
  where brand_id = 'edededed-eded-4ded-8ded-edededededed';
  delete from public.drops
  where brand_id = 'edededed-eded-4ded-8ded-edededededed';
  delete from public.menu_items
  where brand_id = 'edededed-eded-4ded-8ded-edededededed';
  delete from public.menu_categories
  where brand_id = 'edededed-eded-4ded-8ded-edededededed';
  delete from public.menus
  where brand_id = 'edededed-eded-4ded-8ded-edededededed';
  delete from public.brands
  where id = 'edededed-eded-4ded-8ded-edededededed';
  set session_replication_role = origin;
  insert into public.brands (id, slug, name) values
    ('edededed-eded-4ded-8ded-edededededed',
     'drop-transition-concurrency', 'Drop Transition Concurrency');
  insert into public.menus (id, brand_id, name) values
    ('edededed-1000-4000-8000-000000000001',
     'edededed-eded-4ded-8ded-edededededed', 'Concurrency');
  insert into public.menu_categories (id, brand_id, menu_id, title, slug) values
    ('edededed-2000-4000-8000-000000000001',
     'edededed-eded-4ded-8ded-edededededed',
     'edededed-1000-4000-8000-000000000001', 'Drops', 'drops');
  insert into public.menu_items (
    id, brand_id, menu_id, category_id, slug, name, base_price_cents
  ) values (
    'edededed-3000-4000-8000-000000000001',
    'edededed-eded-4ded-8ded-edededededed',
    'edededed-1000-4000-8000-000000000001',
    'edededed-2000-4000-8000-000000000001',
    'concurrency-latte', 'Concurrency latte', 500
  );
  insert into public.drops (
    id, brand_id, item_id, reveal_at, starts_at, ends_at, status
  ) values
    ('edededed-4000-4000-8000-000000000001',
     'edededed-eded-4ded-8ded-edededededed',
     'edededed-3000-4000-8000-000000000001',
     '2029-12-31', '2030-01-03', '2030-01-04', 'scheduled'),
    ('edededed-4000-4000-8000-000000000002',
     'edededed-eded-4ded-8ded-edededededed',
     'edededed-3000-4000-8000-000000000001',
     '2029-12-31', '2030-01-03', '2030-01-04', 'scheduled');
$setup$);

select is(
  dblink_send_query('drop_worker_a', $worker_a$
    with advanced as materialized (
      select id from public.advance_due_drop_batch('2030-01-01', 1)
    ), recorded as (
      insert into public.drop_transition_concurrency_results (worker, drop_id)
      select 'a', id from advanced returning drop_id
    ), pause_while_locked as materialized (
      select pg_sleep(3) from recorded
    )
    select drop_id::text from recorded cross join pause_while_locked
  $worker_a$),
  1,
  'the first worker starts an asynchronous transition batch'
);
select pg_sleep(0.5);
select is(
  dblink_is_busy('drop_worker_a'),
  1,
  'the first worker still holds its claim while the second starts'
);

select results_eq($test$
  select drop_id
  from dblink('drop_worker_b', $worker_b$
    with advanced as materialized (
      select id from public.advance_due_drop_batch('2030-01-01', 1)
    ), recorded as (
      insert into public.drop_transition_concurrency_results (worker, drop_id)
      select 'b', id from advanced returning drop_id
    )
    select drop_id::text from recorded
  $worker_b$) as result(drop_id uuid)
$test$, $expected$
  values ('edededed-4000-4000-8000-000000000002'::uuid)
$expected$, 'the second worker skips the row locked by the first worker');

select results_eq($test$
  select drop_id
  from dblink_get_result('drop_worker_a') as result(drop_id uuid)
$test$, $expected$
  values ('edededed-4000-4000-8000-000000000001'::uuid)
$expected$, 'the first worker completes its originally claimed row');

select results_eq($test$
  select id, status
  from public.drops
  where brand_id = 'edededed-eded-4ded-8ded-edededededed'
  order by id
$test$, $expected$
  values
    ('edededed-4000-4000-8000-000000000001'::uuid, 'revealed'::text),
    ('edededed-4000-4000-8000-000000000002'::uuid, 'revealed'::text)
$expected$, 'both disjoint claims commit exactly one transition');

select dblink_exec('drop_worker_b', $cleanup$
  set session_replication_role = replica;
  delete from public.catalog_nodes
  where brand_id = 'edededed-eded-4ded-8ded-edededededed';
  delete from public.drops
  where brand_id = 'edededed-eded-4ded-8ded-edededededed';
  delete from public.menu_items
  where brand_id = 'edededed-eded-4ded-8ded-edededededed';
  delete from public.menu_categories
  where brand_id = 'edededed-eded-4ded-8ded-edededededed';
  delete from public.menus
  where brand_id = 'edededed-eded-4ded-8ded-edededededed';
  delete from public.brands
  where id = 'edededed-eded-4ded-8ded-edededededed';
  drop table if exists public.drop_transition_concurrency_results;
  set session_replication_role = origin;
$cleanup$);
select dblink_disconnect('drop_worker_a');
select dblink_disconnect('drop_worker_b');

select * from finish();
rollback;
