begin;
create extension if not exists pgtap with schema extensions;
set search_path = extensions, public, pg_catalog;
select plan(32);

insert into public.brands (id, slug, name) values
  ('f2222222-2222-4222-8222-222222222222', 'fee-link-fencing', 'Fee Link Fencing');
insert into public.locations (id, brand_id, name) values
  ('f2220000-0000-4000-8000-000000000001',
   'f2222222-2222-4222-8222-222222222222', 'Link Location');
insert into public.orders (
  id, brand_id, location_id, status, tender_type, subtotal_cents, total_cents,
  square_checkout_url, square_payment_link_id, square_order_id
) values
  ('f2220000-0000-4000-8000-000000000201', 'f2222222-2222-4222-8222-222222222222',
   'f2220000-0000-4000-8000-000000000001', 'created', 'square_link', 1000, 1000,
   null, null, null),
  ('f2220000-0000-4000-8000-000000000202', 'f2222222-2222-4222-8222-222222222222',
   'f2220000-0000-4000-8000-000000000001', 'created', 'square_link', 1000, 1000,
   null, null, null),
  ('f2220000-0000-4000-8000-000000000203', 'f2222222-2222-4222-8222-222222222222',
   'f2220000-0000-4000-8000-000000000001', 'created', 'external', 1000, 1000,
   null, null, null),
  ('f2220000-0000-4000-8000-000000000204', 'f2222222-2222-4222-8222-222222222222',
   'f2220000-0000-4000-8000-000000000001', 'cancelled', 'square_link', 1000, 1000,
   null, null, null),
  ('f2220000-0000-4000-8000-000000000205', 'f2222222-2222-4222-8222-222222222222',
   'f2220000-0000-4000-8000-000000000001', 'created', 'square_link', 1000, 1000,
   null, null, null),
  ('f2220000-0000-4000-8000-000000000206', 'f2222222-2222-4222-8222-222222222222',
   'f2220000-0000-4000-8000-000000000001', 'created', 'square_link', 1000, 1000,
   'https://checkout.example/original', 'link-original', 'order-original'),
  ('f2220000-0000-4000-8000-000000000207', 'f2222222-2222-4222-8222-222222222222',
   'f2220000-0000-4000-8000-000000000001', 'created', 'square_link', 1000, 1000,
   null, null, null),
  ('f2220000-0000-4000-8000-000000000208', 'f2222222-2222-4222-8222-222222222222',
   'f2220000-0000-4000-8000-000000000001', 'created', 'square_link', 1000, 1000,
   null, null, null);
insert into public.platform_fee_quotes (
  order_id, brand_id, location_id, month_start, month_end, gross_cents,
  fee_cents, fee_bps_applied, expires_at, cleanup_claimed_at, claim_generation
)
select target.id, target.brand_id, target.location_id, date_trunc('month', now()),
  date_trunc('month', now()) + interval '1 month', 1000, 30, 300,
  now() + interval '1 hour',
  case when target.id = 'f2220000-0000-4000-8000-000000000205' then now() end,
  ('f2220000-0000-4000-8000-' || right(target.id::text, 12))::uuid
from public.orders target
where target.brand_id = 'f2222222-2222-4222-8222-222222222222';

set local role service_role;
select is(public.bind_square_checkout_link(
  'f2220000-0000-4000-8000-000000000201', 'f2220000-0000-4000-8000-000000000201',
  'https://checkout.example/valid', 'link-valid', 'order-valid'), true,
  'an active link claim persists valid Square identities');
select results_eq($test$
  select square_checkout_url, square_payment_link_id, square_order_id from public.orders
  where id = 'f2220000-0000-4000-8000-000000000201'
$test$, $expected$
  values ('https://checkout.example/valid'::text, 'link-valid'::text, 'order-valid'::text)
$expected$, 'valid link binding persists every identity');
select is(public.bind_square_checkout_link(
  'f2220000-0000-4000-8000-000000000201', 'f2220000-0000-4000-8000-000000000201',
  'https://checkout.example/valid', 'link-valid', 'order-valid'), true,
  'an exact link bind replay is idempotent');

select is(public.bind_square_checkout_link(
  'f2220000-0000-4000-8000-000000000202', 'f2220000-0000-4000-8000-999999999999',
  'https://checkout.example/stale', 'link-stale', 'order-stale'), false,
  'a stale claim generation cannot bind a checkout link');
select is((select square_checkout_url from public.orders
  where id = 'f2220000-0000-4000-8000-000000000202'), null,
  'stale generation leaves checkout identity unset');
select is(public.bind_square_checkout_link(
  'f2220000-0000-4000-8000-000000000203', 'f2220000-0000-4000-8000-000000000203',
  'https://checkout.example/wrong-tender', 'link-wrong', 'order-wrong'), false,
  'checkout binding rejects a non-link tender');
select is(public.bind_square_checkout_link(
  'f2220000-0000-4000-8000-000000000204', 'f2220000-0000-4000-8000-000000000204',
  'https://checkout.example/cancelled', 'link-cancelled', 'order-cancelled'), false,
  'checkout binding rejects a non-created order');
select is(public.bind_square_checkout_link(
  'f2220000-0000-4000-8000-000000000205', 'f2220000-0000-4000-8000-000000000205',
  'https://checkout.example/cleanup', 'link-cleanup', 'order-cleanup'), false,
  'checkout binding refuses cleanup-owned quotes');
select is((select square_checkout_url from public.orders
  where id = 'f2220000-0000-4000-8000-000000000205'), null,
  'cleanup ownership leaves checkout identity unset');

select is(public.bind_square_checkout_link(
  'f2220000-0000-4000-8000-000000000206', 'f2220000-0000-4000-8000-000000000206',
  'https://checkout.example/original', 'link-original', 'order-original'), true,
  'an exact persisted-link replay succeeds');
select is(public.bind_square_checkout_link(
  'f2220000-0000-4000-8000-000000000206', 'f2220000-0000-4000-8000-000000000206',
  'https://checkout.example/changed', 'link-original', 'order-original'), false,
  'a conflicting checkout URL is refused');
select is(public.bind_square_checkout_link(
  'f2220000-0000-4000-8000-000000000206', 'f2220000-0000-4000-8000-000000000206',
  'https://checkout.example/original', 'link-changed', 'order-original'), false,
  'a conflicting payment-link id is refused');
select is(public.bind_square_checkout_link(
  'f2220000-0000-4000-8000-000000000206', 'f2220000-0000-4000-8000-000000000206',
  'https://checkout.example/original', 'link-original', 'order-changed'), false,
  'a conflicting Square order id is refused');
select results_eq($test$
  select square_checkout_url, square_payment_link_id, square_order_id from public.orders
  where id = 'f2220000-0000-4000-8000-000000000206'
$test$, $expected$
  values ('https://checkout.example/original'::text, 'link-original'::text, 'order-original'::text)
$expected$, 'conflicting replays do not alter persisted identities');

select is(public.bind_square_checkout_link(
  'f2220000-0000-4000-8000-000000000207', 'f2220000-0000-4000-8000-000000000207',
  'https://checkout.example/no-order', 'link-no-order', null), true,
  'a provider response without a Square order id remains bindable');
select results_eq($test$
  select square_checkout_url, square_payment_link_id, square_order_id from public.orders
  where id = 'f2220000-0000-4000-8000-000000000207'
$test$, $expected$
  values ('https://checkout.example/no-order'::text, 'link-no-order'::text, null::text)
$expected$, 'nullable Square order identity is persisted faithfully');

select is(public.bind_square_checkout_link(
  'f2220000-0000-4000-8000-000000000299', 'f2220000-0000-4000-8000-000000000299',
  'https://checkout.example/missing', 'link-missing', null), false,
  'an order without a durable quote cannot bind a link');
select throws_ok($test$select public.bind_square_checkout_link(
  'f2220000-0000-4000-8000-000000000208', 'f2220000-0000-4000-8000-000000000208',
  'http://checkout.example/insecure', 'link-boundary', null)$test$,
  'P0001', 'square checkout link identity is invalid', 'checkout URL requires HTTPS');
select throws_ok($test$select public.bind_square_checkout_link(
  'f2220000-0000-4000-8000-000000000208', 'f2220000-0000-4000-8000-000000000208',
  'https://checkout.example/white space', 'link-boundary', null)$test$,
  'P0001', 'square checkout link identity is invalid', 'checkout URL rejects whitespace');
select throws_ok($test$select public.bind_square_checkout_link(
  'f2220000-0000-4000-8000-000000000208', 'f2220000-0000-4000-8000-000000000208',
  'https://ab', 'link-boundary', null)$test$,
  'P0001', 'square checkout link identity is invalid', 'checkout URL enforces minimum length');
select throws_ok(format('select public.bind_square_checkout_link(%L,%L,%L,%L,null)',
  'f2220000-0000-4000-8000-000000000208', 'f2220000-0000-4000-8000-000000000208',
  'https://' || repeat('a', 2049), 'link-boundary'), 'P0001',
  'square checkout link identity is invalid', 'checkout URL enforces maximum length');
select throws_ok($test$select public.bind_square_checkout_link(
  'f2220000-0000-4000-8000-000000000208', 'f2220000-0000-4000-8000-000000000208',
  null, 'link-boundary', null)$test$, 'P0001',
  'square checkout link identity is invalid', 'checkout URL cannot be null');
select throws_ok($test$select public.bind_square_checkout_link(
  'f2220000-0000-4000-8000-000000000208', 'f2220000-0000-4000-8000-000000000208',
  'https://checkout.example/boundary', 'ab', null)$test$, 'P0001',
  'square checkout link identity is invalid', 'payment-link id enforces minimum length');
select throws_ok(format('select public.bind_square_checkout_link(%L,%L,%L,%L,null)',
  'f2220000-0000-4000-8000-000000000208', 'f2220000-0000-4000-8000-000000000208',
  'https://checkout.example/boundary', repeat('l', 256)), 'P0001',
  'square checkout link identity is invalid', 'payment-link id enforces maximum length');
select throws_ok($test$select public.bind_square_checkout_link(
  'f2220000-0000-4000-8000-000000000208', 'f2220000-0000-4000-8000-000000000208',
  'https://checkout.example/boundary', 'link invalid', null)$test$, 'P0001',
  'square checkout link identity is invalid', 'payment-link id rejects whitespace');
select throws_ok($test$select public.bind_square_checkout_link(
  'f2220000-0000-4000-8000-000000000208', 'f2220000-0000-4000-8000-000000000208',
  'https://checkout.example/boundary', null, null)$test$, 'P0001',
  'square checkout link identity is invalid', 'payment-link id cannot be null');
select throws_ok($test$select public.bind_square_checkout_link(
  'f2220000-0000-4000-8000-000000000208', 'f2220000-0000-4000-8000-000000000208',
  'https://checkout.example/boundary', 'link-boundary', 'ab')$test$, 'P0001',
  'square checkout link identity is invalid', 'Square order id enforces minimum length');
select throws_ok(format('select public.bind_square_checkout_link(%L,%L,%L,%L,%L)',
  'f2220000-0000-4000-8000-000000000208', 'f2220000-0000-4000-8000-000000000208',
  'https://checkout.example/boundary', 'link-boundary', repeat('o', 256)), 'P0001',
  'square checkout link identity is invalid', 'Square order id enforces maximum length');
select throws_ok($test$select public.bind_square_checkout_link(
  'f2220000-0000-4000-8000-000000000208', 'f2220000-0000-4000-8000-000000000208',
  'https://checkout.example/boundary', 'link-boundary', 'order invalid')$test$, 'P0001',
  'square checkout link identity is invalid', 'Square order id rejects whitespace');
reset role;

select * from finish();
rollback;
