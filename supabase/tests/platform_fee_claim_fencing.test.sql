begin;
create extension if not exists pgtap with schema extensions;
set search_path = extensions, public, pg_catalog;
select plan(36);

select ok(not has_function_privilege('anon',
  'public.claim_platform_fee_quote(uuid,uuid,bigint,integer,integer,bigint,timestamptz,timestamptz,boolean)',
  'EXECUTE'), 'anon cannot claim a platform fee quote');
select ok(not has_function_privilege('authenticated',
  'public.claim_platform_fee_quote(uuid,uuid,bigint,integer,integer,bigint,timestamptz,timestamptz,boolean)',
  'EXECUTE'), 'authenticated clients cannot claim a platform fee quote');
select ok(has_function_privilege('service_role',
  'public.claim_platform_fee_quote(uuid,uuid,bigint,integer,integer,bigint,timestamptz,timestamptz,boolean)',
  'EXECUTE'), 'service role can claim a platform fee quote');
select ok(not has_function_privilege('anon',
  'public.release_platform_fee_quote(uuid,uuid)', 'EXECUTE'),
  'anon cannot release a platform fee quote');
select ok(not has_function_privilege('authenticated',
  'public.release_platform_fee_quote(uuid,uuid)', 'EXECUTE'),
  'authenticated clients cannot release a platform fee quote');
select ok(has_function_privilege('service_role',
  'public.release_platform_fee_quote(uuid,uuid)', 'EXECUTE'),
  'service role can release a platform fee quote');
select ok(not has_function_privilege('anon',
  'public.bind_square_checkout_link(uuid,uuid,text,text,text)', 'EXECUTE'),
  'anon cannot bind a Square checkout link');
select ok(not has_function_privilege('authenticated',
  'public.bind_square_checkout_link(uuid,uuid,text,text,text)', 'EXECUTE'),
  'authenticated clients cannot bind a Square checkout link');
select ok(has_function_privilege('service_role',
  'public.bind_square_checkout_link(uuid,uuid,text,text,text)', 'EXECUTE'),
  'service role can bind a Square checkout link');
select ok(not has_function_privilege('anon',
  'public.bind_square_payment(uuid,uuid,text,text)', 'EXECUTE'),
  'anon cannot bind a Square card payment');
select ok(not has_function_privilege('authenticated',
  'public.bind_square_payment(uuid,uuid,text,text)', 'EXECUTE'),
  'authenticated clients cannot bind a Square card payment');
select ok(has_function_privilege('service_role',
  'public.bind_square_payment(uuid,uuid,text,text)', 'EXECUTE'),
  'service role can bind a Square card payment');
select has_index('public', 'operation_notification_outbox',
  'operation_outbox_sending_due_idx', 'sending notification recovery is indexed');

insert into public.brands (id, slug, name) values
  ('f1111111-1111-4111-8111-111111111111', 'fee-fencing', 'Fee Fencing');
insert into public.locations (id, brand_id, name) values
  ('f1110000-0000-4000-8000-000000000001',
   'f1111111-1111-4111-8111-111111111111', 'Fee Location');
insert into public.orders (
  id, brand_id, location_id, tender_type, subtotal_cents, total_cents
) values
  ('f1110000-0000-4000-8000-000000000101',
   'f1111111-1111-4111-8111-111111111111',
   'f1110000-0000-4000-8000-000000000001', 'square_card', 1000, 1000),
  ('f1110000-0000-4000-8000-000000000102',
   'f1111111-1111-4111-8111-111111111111',
   'f1110000-0000-4000-8000-000000000001', 'external', 1000, 1000),
  ('f1110000-0000-4000-8000-000000000103',
   'f1111111-1111-4111-8111-111111111111',
   'f1110000-0000-4000-8000-000000000001', 'square_card', 1000, 1000),
  ('f1110000-0000-4000-8000-000000000104',
   'f1111111-1111-4111-8111-111111111111',
   'f1110000-0000-4000-8000-000000000001', 'square_card', 1000, 1000),
  ('f1110000-0000-4000-8000-000000000105',
   'f1111111-1111-4111-8111-111111111111',
   'f1110000-0000-4000-8000-000000000001', 'square_card', 1000, 1000);

set local role service_role;
select set_config('test.fee_g1', quote_claim_generation::text, true)
from public.claim_platform_fee_quote(
  'f1110000-0000-4000-8000-000000000101',
  'f1110000-0000-4000-8000-000000000001', 1000, 300, 150, 100000,
  date_trunc('month', now()), date_trunc('month', now()) + interval '1 month', false);
select ok(current_setting('test.fee_g1')::uuid is not null,
  'the first claim returns a generation token');
select set_config('test.fee_g2', quote_claim_generation::text, true)
from public.claim_platform_fee_quote(
  'f1110000-0000-4000-8000-000000000101',
  'f1110000-0000-4000-8000-000000000001', 1000, 300, 150, 100000,
  date_trunc('month', now()), date_trunc('month', now()) + interval '1 month', false);
select isnt(current_setting('test.fee_g2')::uuid, current_setting('test.fee_g1')::uuid,
  'renewal rotates the generation token');
select is(public.release_platform_fee_quote(
  'f1110000-0000-4000-8000-000000000101', current_setting('test.fee_g1')::uuid),
  false, 'a stale generation cannot release a renewed quote');
select is((select count(*) from public.platform_fee_quotes
  where order_id = 'f1110000-0000-4000-8000-000000000101'), 1::bigint,
  'stale release preserves the quote');
select is(public.release_platform_fee_quote(
  'f1110000-0000-4000-8000-000000000101', current_setting('test.fee_g2')::uuid),
  true, 'the current generation releases its quote');
select is((select count(*) from public.platform_fee_quotes
  where order_id = 'f1110000-0000-4000-8000-000000000101'), 0::bigint,
  'a successful release removes the quote');

select set_config('test.fee_wrong', quote_claim_generation::text, true)
from public.claim_platform_fee_quote(
  'f1110000-0000-4000-8000-000000000102',
  'f1110000-0000-4000-8000-000000000001', 1000, 300, 150, 100000,
  date_trunc('month', now()), date_trunc('month', now()) + interval '1 month', false);
select is(public.bind_square_payment(
  'f1110000-0000-4000-8000-000000000102', current_setting('test.fee_wrong')::uuid,
  'square-order-wrong', 'square-payment-wrong'), false,
  'payment binding rejects a non-card tender');
select is((select square_order_id from public.orders
  where id = 'f1110000-0000-4000-8000-000000000102'), null,
  'wrong-tender binding leaves the Square order unset');
select is((select square_payment_id from public.orders
  where id = 'f1110000-0000-4000-8000-000000000102'), null,
  'wrong-tender binding leaves the Square payment unset');
select throws_ok(format(
  'select public.bind_square_payment(%L,%L,null,%L)',
  'f1110000-0000-4000-8000-000000000102', current_setting('test.fee_wrong'),
  'square-payment-null-order'), 'P0001', 'square payment identity is invalid',
  'payment binding rejects a null Square order id');
select throws_ok(format(
  'select public.bind_square_payment(%L,%L,%L,null)',
  'f1110000-0000-4000-8000-000000000102', current_setting('test.fee_wrong'),
  'square-order-null-payment'), 'P0001', 'square payment identity is invalid',
  'payment binding rejects a null Square payment id');

select set_config('test.fee_active', quote_claim_generation::text, true)
from public.claim_platform_fee_quote(
  'f1110000-0000-4000-8000-000000000103',
  'f1110000-0000-4000-8000-000000000001', 1000, 300, 150, 100000,
  date_trunc('month', now()), date_trunc('month', now()) + interval '1 month', false);
update public.platform_fee_quotes set cleanup_claimed_at = now()
where order_id = 'f1110000-0000-4000-8000-000000000103';
select is(public.release_platform_fee_quote(
  'f1110000-0000-4000-8000-000000000103', current_setting('test.fee_active')::uuid),
  false, 'release refuses a quote claimed by cleanup');
select is((select count(*) from public.platform_fee_quotes
  where order_id = 'f1110000-0000-4000-8000-000000000103'), 1::bigint,
  'cleanup ownership preserves the quote');
select throws_ok($test$
  insert into public.order_events (brand_id, order_id, type, source)
  values ('f1111111-1111-4111-8111-111111111111',
    'f1110000-0000-4000-8000-000000000103', 'cancelled', 'customer')
$test$, 'P0001', 'square_card_payment_in_flight',
  'an active card quote fences cancellation during charge and bind');
select is((select status::text from public.orders
  where id = 'f1110000-0000-4000-8000-000000000103'), 'created',
  'a fenced cancellation leaves the card order created');
update public.platform_fee_quotes set cleanup_claimed_at = null
where order_id = 'f1110000-0000-4000-8000-000000000103';
select is(public.release_platform_fee_quote(
  'f1110000-0000-4000-8000-000000000103', current_setting('test.fee_active')::uuid),
  true, 'the active owner can release after cleanup relinquishes the quote');
select lives_ok($test$
  insert into public.order_events (brand_id, order_id, type, source)
  values ('f1111111-1111-4111-8111-111111111111',
    'f1110000-0000-4000-8000-000000000103', 'cancelled', 'customer')
$test$, 'cancellation proceeds after the charge reservation is released');
select is((select status::text from public.orders
  where id = 'f1110000-0000-4000-8000-000000000103'), 'cancelled',
  'the released card order reaches cancelled');
select throws_ok($test$select * from public.claim_platform_fee_quote(
  'f1110000-0000-4000-8000-000000000103',
  'f1110000-0000-4000-8000-000000000001', 1000, 300, 150, 100000,
  date_trunc('month', now()), date_trunc('month', now()) + interval '1 month', false)
$test$, 'P0001', 'order does not match platform fee quote',
  'a cancelled card order cannot acquire a new charge reservation');

select set_config('test.fee_distinct', quote_claim_generation::text, true)
from public.claim_platform_fee_quote(
  'f1110000-0000-4000-8000-000000000104',
  'f1110000-0000-4000-8000-000000000001', 1000, 300, 150, 100000,
  date_trunc('month', now()), date_trunc('month', now()) + interval '1 month', false);
update public.orders set square_order_id = 'square-order-original'
where id = 'f1110000-0000-4000-8000-000000000104';
select is(public.bind_square_payment(
  'f1110000-0000-4000-8000-000000000104', current_setting('test.fee_distinct')::uuid,
  'square-order-different', 'square-payment-new'), false,
  'payment binding refuses a distinct existing Square order id');
select is((select square_payment_id from public.orders
  where id = 'f1110000-0000-4000-8000-000000000104'), null,
  'a conflicting Square order leaves payment identity unset');

select set_config('test.fee_valid', quote_claim_generation::text, true)
from public.claim_platform_fee_quote(
  'f1110000-0000-4000-8000-000000000105',
  'f1110000-0000-4000-8000-000000000001', 1000, 300, 150, 100000,
  date_trunc('month', now()), date_trunc('month', now()) + interval '1 month', false);
select is(public.bind_square_payment(
  'f1110000-0000-4000-8000-000000000105', current_setting('test.fee_valid')::uuid,
  'square-order-valid', 'square-payment-valid'), true,
  'the active card claim binds its Square identities');
select results_eq($test$
  select square_order_id, square_payment_id from public.orders
  where id = 'f1110000-0000-4000-8000-000000000105'
$test$, $expected$ values ('square-order-valid'::text, 'square-payment-valid'::text) $expected$,
  'a valid binding persists both Square identities');
reset role;

select * from finish();
rollback;
