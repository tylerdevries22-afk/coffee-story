begin;
create extension if not exists pgtap with schema extensions;
set search_path = extensions, public, pg_catalog;
select plan(20);

insert into public.brands (id, slug, name) values
  ('f5555555-5555-4555-8555-555555555555', 'fee-settlement', 'Fee Settlement');
insert into public.locations (id, brand_id, name) values
  ('f5550000-0000-4000-8000-000000000001',
   'f5555555-5555-4555-8555-555555555555', 'Settlement Location');

insert into public.square_connections (
  id, brand_id, location_id, merchant_id, square_location_id,
  access_token_encrypted, refresh_token_encrypted, expires_at,
  oauth_scope_contract_version
)
select gen_random_uuid(), loc.brand_id, loc.id, 'merchant-test', 'square-test',
  'ciphertext-access', 'ciphertext-refresh', now() + interval '1 hour', 2
from public.locations loc
where not exists (
  select 1 from public.square_connections c where c.location_id = loc.id
);

insert into public.orders (
  id, brand_id, location_id, status, tender_type, subtotal_cents, total_cents,
  square_order_id
)
select ('f5550000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  'f5555555-5555-4555-8555-555555555555',
  'f5550000-0000-4000-8000-000000000001', 'created', 'square_card',
  1000, 1000, 'settlement-order-' || n
from generate_series(1, 6) n;
insert into public.platform_fee_quotes (
  order_id, brand_id, location_id, month_start, month_end, gross_cents,
  fee_cents, fee_bps_applied, expires_at, claim_generation
)
select id, brand_id, location_id, date_trunc('month', now()),
  date_trunc('month', now()) + interval '1 month', 1000, 30, 300,
  now() + interval '1 hour', id
from public.orders where brand_id = 'f5555555-5555-4555-8555-555555555555';

select throws_ok($q$select public.record_square_payment_settlement(
  'f5550000-0000-4000-8000-000000000001', 'settlement-event-1a',
  'settlement-order-1', 'settlement-payment-1', 0, 'payment.updated')$q$,
  'P0001', 'Square settlement does not match its durable fee quote',
  'missing provider app fee cannot settle a nonzero quote');
select throws_ok($q$select public.record_square_payment_settlement(
  'f5550000-0000-4000-8000-000000000001', 'settlement-event-1b',
  'settlement-order-1', 'settlement-payment-1', 29, 'payment.updated')$q$,
  'P0001', 'Square settlement does not match its durable fee quote',
  'understated provider app fee cannot settle');
select is((select status::text from public.orders
  where id = 'f5550000-0000-4000-8000-000000000001'), 'created',
  'fee mismatch leaves the order unpaid');
select is((select count(*) from public.platform_fee_quotes
  where order_id = 'f5550000-0000-4000-8000-000000000001'), 1::bigint,
  'fee mismatch preserves its quote for discrepancy handling');
select is(public.record_square_payment_settlement(
  'f5550000-0000-4000-8000-000000000001', 'settlement-event-1',
  'settlement-order-1', 'settlement-payment-1', 30, 'payment.updated'), true,
  'exact provider receipt settles');
select is(public.record_square_payment_settlement(
  'f5550000-0000-4000-8000-000000000001', 'settlement-event-1',
  'settlement-order-1', 'settlement-payment-1', 30, 'payment.updated'), false,
  'exact receipt replay is a verified no-op');
insert into public.order_events (brand_id, order_id, type, snapshot, square_event_id, source)
values ('f5555555-5555-4555-8555-555555555555',
  'f5550000-0000-4000-8000-000000000002', 'paid',
  '{"square_payment_id":"other-payment","square_event":"payment.updated"}',
  'settlement-event-collision', 'webhook');
select throws_ok($q$select public.record_square_payment_settlement(
  'f5550000-0000-4000-8000-000000000001', 'settlement-event-collision',
  'settlement-order-1', 'settlement-payment-1', 30, 'payment.updated')$q$,
  'P0001', 'Square event is already bound to a different settlement',
  'paid receipt replay still validates event ownership');
select is((select order_id from public.order_events where square_event_id =
  'settlement-event-collision'), 'f5550000-0000-4000-8000-000000000002'::uuid,
  'event collision rejection preserves its original owner');
select results_eq($q$select status::text, square_payment_id from public.orders
  where id = 'f5550000-0000-4000-8000-000000000001'$q$,
  $$values ('paid'::text, 'settlement-payment-1'::text)$$,
  'exact settlement binds payment and paid state');
select is((select count(*) from public.platform_fee_quotes
  where order_id = 'f5550000-0000-4000-8000-000000000001'), 0::bigint,
  'exact settlement removes finalized quote');
select throws_ok($q$select public.record_square_payment_settlement(
  'f5550000-0000-4000-8000-000000000002', 'settlement-event-2',
  'settlement-order-1', 'settlement-payment-2', 30, 'payment.updated')$q$,
  'P0001', 'Square settlement does not match its durable order identity',
  'same-amount payment cannot cross-bind through a wrong Square order');
select is((select square_payment_id from public.orders
  where id = 'f5550000-0000-4000-8000-000000000002'), null,
  'cross-order rejection leaves target payment unset');

insert into public.platform_fees (
  brand_id, location_id, order_id, gross_cents, fee_cents,
  fee_bps_applied, square_payment_id
) values (
  'f5555555-5555-4555-8555-555555555555',
  'f5550000-0000-4000-8000-000000000001',
  'f5550000-0000-4000-8000-000000000003', 1000, 30, 300,
  'settlement-orphan-payment'
);
delete from public.orders where id = 'f5550000-0000-4000-8000-000000000003';
select is((select order_id from public.platform_fees
  where square_payment_id = 'settlement-orphan-payment'), null,
  'fixture receipt is orphaned through ON DELETE SET NULL');
select throws_ok($q$select public.record_square_payment_settlement(
  'f5550000-0000-4000-8000-000000000004', 'settlement-event-4',
  'settlement-order-4', 'settlement-orphan-payment', 30, 'payment.updated')$q$,
  'P0001', 'Square payment is already bound to a different fee receipt',
  'orphan receipt cannot be rebound to another order');
select is((select square_payment_id from public.orders
  where id = 'f5550000-0000-4000-8000-000000000004'), null,
  'orphan-receipt rejection is atomic');

insert into public.platform_fees (
  brand_id, location_id, order_id, gross_cents, fee_cents,
  fee_bps_applied, square_payment_id
) values (
  'f5555555-5555-4555-8555-555555555555',
  'f5550000-0000-4000-8000-000000000001',
  'f5550000-0000-4000-8000-000000000005', 1000, 30, 299,
  'settlement-bps-payment'
);
update public.orders set square_payment_id = 'settlement-bps-payment'
where id = 'f5550000-0000-4000-8000-000000000005';
select throws_ok($q$select public.record_square_payment_settlement(
  'f5550000-0000-4000-8000-000000000005', 'settlement-event-5',
  'settlement-order-5', 'settlement-bps-payment', 30, 'payment.updated')$q$,
  'P0001', 'Square payment is already bound to a different fee receipt',
  'existing receipt replay verifies deterministic fee basis points');
select is((select status::text from public.orders
  where id = 'f5550000-0000-4000-8000-000000000005'), 'created',
  'basis-point mismatch leaves order unpaid');
select throws_ok($q$select public.record_square_payment_settlement(
  'f5550000-0000-4000-8000-000000000006', 'settlement-event-6',
  'settlement-order-6', 'settlement-payment-6', 901, 'payment.updated')$q$,
  'P0001', 'invalid Square settlement amounts',
  'settlement enforces Square 90 percent money cap');
select throws_ok($q$select public.record_square_payment_settlement(
  'f5550000-0000-4000-8000-000000000006', 'bad event',
  'settlement-order-6', 'settlement-payment-6', 30, 'payment.updated')$q$,
  'P0001', 'Square settlement identity and fee are required',
  'settlement validates provider identities');
select is((select count(*) from public.platform_fees
  where order_id = 'f5550000-0000-4000-8000-000000000006'), 0::bigint,
  'rejected settlement writes no fee receipt');

select * from finish();
rollback;
