begin;
create extension if not exists pgtap with schema extensions;
set search_path = extensions, public, pg_catalog;
select plan(5);

insert into public.brands (id, slug, name) values
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'drop-visibility', 'Drop Visibility');
insert into public.menus (id, brand_id, name, is_published) values
  ('dddddddd-1000-4000-8000-000000000001',
   'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'Public menu', true);
insert into public.menu_categories (id, brand_id, menu_id, title, slug) values
  ('dddddddd-2000-4000-8000-000000000001',
   'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
   'dddddddd-1000-4000-8000-000000000001', 'Drops', 'drops');
insert into public.menu_items (
  id, brand_id, menu_id, category_id, slug, name, base_price_cents
) values (
  'dddddddd-3000-4000-8000-000000000001',
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  'dddddddd-1000-4000-8000-000000000001',
  'dddddddd-2000-4000-8000-000000000001',
  'limited-latte', 'Limited latte', 500
);
insert into public.drops (
  id, brand_id, item_id, reveal_at, starts_at, ends_at, status
) values
  ('dddddddd-4000-4000-8000-000000000001',
   'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
   'dddddddd-3000-4000-8000-000000000001',
   now() + interval '1 day', now() + interval '2 days', now() + interval '3 days', 'scheduled'),
  ('dddddddd-4000-4000-8000-000000000002',
   'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
   'dddddddd-3000-4000-8000-000000000001',
   now() - interval '1 day', now() + interval '1 day', now() + interval '2 days', 'revealed'),
  ('dddddddd-4000-4000-8000-000000000003',
   'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
   'dddddddd-3000-4000-8000-000000000001',
   now() - interval '2 days', now() - interval '1 hour', now() + interval '1 day', 'live'),
  ('dddddddd-4000-4000-8000-000000000004',
   'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
   'dddddddd-3000-4000-8000-000000000001',
   null, now() + interval '1 day', now() + interval '2 days', 'draft');

set local role anon;
select is((select count(*) from public.drops), 2::bigint,
  'anonymous guests see only revealed and orderable drops');
select is_empty($test$
  select id from public.drops
  where id = 'dddddddd-4000-4000-8000-000000000001'
$test$, 'a scheduled drop stays hidden before reveal_at');
select isnt_empty($test$
  select id from public.drops
  where id = 'dddddddd-4000-4000-8000-000000000002'
$test$, 'a revealed drop is public before its order window');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object(
  'role', 'authenticated',
  'app_metadata', jsonb_build_object(
    'role', 'staff',
    'brand_id', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    'location_ids', '[]'::jsonb
  )
)::text, true);
select is((select count(*) from public.drops
  where brand_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'), 4::bigint,
  'brand staff retain access to every drop lifecycle state');
reset role;

select lives_ok($test$select app.assert_drop_reveal_visibility()$test$,
  'release readiness verifies the guarded drops policy');
select * from finish();
rollback;
