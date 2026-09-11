begin;
create extension if not exists pgtap with schema extensions;
set search_path = extensions, public, pg_catalog;
select plan(37);

insert into public.brands (id, slug, name) values
  ('f3333333-3333-4333-8333-333333333333', 'fee-card-binding', 'Fee Card Binding');
insert into public.locations (id, brand_id, name) values
  ('f3330000-0000-4000-8000-000000000001',
   'f3333333-3333-4333-8333-333333333333', 'Card Location');
insert into public.orders (
  id, brand_id, location_id, status, tender_type, subtotal_cents, total_cents,
  square_order_id, square_payment_id
)
select ('f3330000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  'f3333333-3333-4333-8333-333333333333',
  'f3330000-0000-4000-8000-000000000001',
  case when n = 4 then 'cancelled'::app.order_status else 'created'::app.order_status end,
  case when n = 3 then 'external' else 'square_card' end, 1000, 1000,
  case when n in (4, 6, 7, 9, 10, 11) then 'order-' || n end,
  case when n = 11 then 'payment-11' end
from generate_series(1, 12) n;
insert into public.platform_fee_quotes (
  order_id, brand_id, location_id, month_start, month_end, gross_cents,
  fee_cents, fee_bps_applied, expires_at, cleanup_claimed_at, claim_generation
)
select id, brand_id, location_id, date_trunc('month', now()),
  date_trunc('month', now()) + interval '1 month', 1000, 30, 300,
  case when id in (
    'f3330000-0000-4000-8000-000000000007'::uuid,
    'f3330000-0000-4000-8000-000000000009'::uuid)
    then now() - interval '1 second' else now() + interval '1 hour' end,
  case when id in (
    'f3330000-0000-4000-8000-000000000005'::uuid,
    'f3330000-0000-4000-8000-000000000009'::uuid) then now() end,
  case when id = 'f3330000-0000-4000-8000-000000000009'::uuid
    then 'f3330000-0000-4000-8000-999999999998'::uuid else id end
from public.orders where brand_id = 'f3333333-3333-4333-8333-333333333333';

select is(public.bind_square_payment_attempt(
  'f3330000-0000-4000-8000-000000000001', 'f3330000-0000-4000-8000-000000000001',
  'order-valid'), true, 'active card owner binds provider order before charge');
select is((select square_order_id from public.orders
  where id = 'f3330000-0000-4000-8000-000000000001'), 'order-valid',
  'precharge provider order identity is durable');
select is(public.bind_square_payment_attempt(
  'f3330000-0000-4000-8000-000000000001', 'f3330000-0000-4000-8000-000000000001',
  'order-valid'), true, 'exact active attempt replay is idempotent');
select is(public.bind_square_payment_attempt(
  'f3330000-0000-4000-8000-000000000002', 'f3330000-0000-4000-8000-999999999999',
  'order-stale'), false, 'stale generation cannot prebind');
select is(public.bind_square_payment_attempt(
  'f3330000-0000-4000-8000-000000000003', 'f3330000-0000-4000-8000-000000000003',
  'order-3'), false, 'wrong tender cannot prebind');
select is(public.bind_square_payment_attempt(
  'f3330000-0000-4000-8000-000000000004', 'f3330000-0000-4000-8000-000000000004',
  'order-4'), false, 'cancelled exact prebind replay cannot resume a charge');
select is(public.bind_square_payment_attempt(
  'f3330000-0000-4000-8000-000000000005', 'f3330000-0000-4000-8000-000000000005',
  'order-cleanup'), false, 'cleanup ownership fences precharge binding');
select is(public.bind_square_payment_attempt(
  'f3330000-0000-4000-8000-000000000007', 'f3330000-0000-4000-8000-000000000007',
  'order-7'), false, 'expired ownership cannot prebind or replay a charge');
select is(public.bind_square_payment_attempt(
  'f3330000-0000-4000-8000-000000000008', 'f3330000-0000-4000-8000-000000000008',
  'order-6'), false, 'provider order identity cannot move between orders');
select throws_ok($q$select public.bind_square_payment_attempt(
  'f3330000-0000-4000-8000-000000000008',
  'f3330000-0000-4000-8000-000000000008', 'bad order')$q$,
  'P0001', 'square payment attempt identity is invalid', 'prebind validates identity');

select is(public.bind_square_payment(
  'f3330000-0000-4000-8000-000000000001', 'f3330000-0000-4000-8000-000000000001',
  'order-valid', 'payment-valid'), true, 'prebound attempt binds its payment');
select results_eq($q$select square_order_id, square_payment_id from public.orders
  where id = 'f3330000-0000-4000-8000-000000000001'$q$,
  $$values ('order-valid'::text, 'payment-valid'::text)$$,
  'both provider identities remain bound');
select is(public.bind_square_payment(
  'f3330000-0000-4000-8000-000000000001', 'f3330000-0000-4000-8000-000000000001',
  'order-valid', 'payment-valid'), true, 'exact payment replay is idempotent');
select is(public.bind_square_payment(
  'f3330000-0000-4000-8000-000000000001', 'f3330000-0000-4000-8000-000000000001',
  'order-valid', 'payment-conflict'), false, 'payment replay cannot change identity');
select is(public.bind_square_payment(
  'f3330000-0000-4000-8000-000000000008', 'f3330000-0000-4000-8000-000000000008',
  'order-unbound', 'payment-unbound'), false, 'payment binding requires prebinding');
select is(public.bind_square_payment(
  'f3330000-0000-4000-8000-000000000011', 'f3330000-0000-4000-8000-000000000011',
  'order-11', 'payment-11'), true, 'exact already-bound payment is replay-safe');
delete from public.platform_fee_quotes
where order_id = 'f3330000-0000-4000-8000-000000000011';
select is(public.bind_square_payment(
  'f3330000-0000-4000-8000-000000000011', 'f3330000-0000-4000-8000-999999999999',
  'order-11', 'payment-missing'), false, 'quote-absent partial identity is strict false');
select is(public.bind_square_payment_attempt(
  'f3330000-0000-4000-8000-000000000011', 'f3330000-0000-4000-8000-000000000011',
  'order-11'), false, 'quote-absent attempt replay is strict false');

select public.bind_square_payment_attempt(
  'f3330000-0000-4000-8000-000000000002', 'f3330000-0000-4000-8000-000000000002',
  'order-2');
select is(public.finalize_square_card_payment(
  'f3330000-0000-4000-8000-000000000002', 'f3330000-0000-4000-8000-000000000002',
  'order-2', 'payment-2', 0), false, 'zero provider app fee cannot settle a nonzero quote');
select is(public.finalize_square_card_payment(
  'f3330000-0000-4000-8000-000000000002', 'f3330000-0000-4000-8000-000000000002',
  'order-2', 'payment-2', 29), false, 'understated provider app fee cannot settle');
select is((select status::text from public.orders
  where id = 'f3330000-0000-4000-8000-000000000002'), 'created',
  'fee discrepancy preserves unpaid state');
select is(public.finalize_square_card_payment(
  'f3330000-0000-4000-8000-000000000002', 'f3330000-0000-4000-8000-000000000002',
  'order-2', 'payment-2', 30), true, 'exact provider app fee finalizes atomically');
select is((select status::text from public.orders
  where id = 'f3330000-0000-4000-8000-000000000002'), 'paid',
  'atomic finalization records paid state');
select results_eq($q$select fee_cents, fee_bps_applied from public.platform_fees
  where order_id = 'f3330000-0000-4000-8000-000000000002'$q$,
  $$values (30::bigint, 300::integer)$$, 'finalization records exact fee receipt');
select is((select count(*) from public.platform_fee_quotes
  where order_id = 'f3330000-0000-4000-8000-000000000002'), 0::bigint,
  'finalized quote is removed');
select is(public.bind_square_payment(
  'f3330000-0000-4000-8000-000000000002', 'f3330000-0000-4000-8000-999999999999',
  'order-2', 'payment-2'), true, 'quote-absent bind replay requires exact fee receipt');
select is(public.finalize_square_card_payment(
  'f3330000-0000-4000-8000-000000000002', 'f3330000-0000-4000-8000-999999999999',
  'order-2', 'payment-2', 30), true, 'exact finalizer replay survives quote cleanup');
select is(public.finalize_square_card_payment(
  'f3330000-0000-4000-8000-000000000002', 'f3330000-0000-4000-8000-999999999999',
  'order-2', 'payment-2', 31), false, 'exact replay verifies immutable fee');
select results_eq($q$select gross_cents, quoted_fee_cents, quoted_fee_bps_applied, quote_finalized
  from public.get_square_payment_quote('f3330000-0000-4000-8000-000000000002', 'order-2')$q$,
  $$values (1000::bigint, 30::bigint, 300::integer, true)$$,
  'recovery reads finalized immutable receipt');

select public.bind_square_payment_attempt(
  'f3330000-0000-4000-8000-000000000008', 'f3330000-0000-4000-8000-000000000008',
  'order-8');
select is(public.record_square_payment_settlement(
  'f3330000-0000-4000-8000-000000000008', 'event-8', 'order-8', 'payment-8', 30,
  'payment.updated'), true, 'webhook settlement can win before finalizer');
select is(public.finalize_square_card_payment(
  'f3330000-0000-4000-8000-000000000008', 'f3330000-0000-4000-8000-999999999999',
  'order-8', 'payment-8', 30), true, 'attended path reconciles exact webhook winner');

select is(public.finalize_square_card_payment(
  'f3330000-0000-4000-8000-000000000009', 'f3330000-0000-4000-8000-000000000009',
  'order-9', 'payment-9', 30), false, 'stale pre-cleanup generation cannot finalize');
select is(public.finalize_square_card_payment(
  'f3330000-0000-4000-8000-000000000009',
  (select claim_generation from public.platform_fee_quotes
    where order_id = 'f3330000-0000-4000-8000-000000000009'),
  'order-9', 'payment-9', 30), true,
  'current cleanup generation can finalize discovered completed payment');
select is((select status::text from public.orders
  where id = 'f3330000-0000-4000-8000-000000000009'), 'paid',
  'cleanup reconciliation records paid state');

select results_eq($q$select gross_cents, quoted_fee_cents, quoted_fee_bps_applied, quote_finalized
  from public.get_square_payment_quote('f3330000-0000-4000-8000-000000000010', 'order-10')$q$,
  $$values (1000::bigint, 30::bigint, 300::integer, false)$$,
  'prebound recovery reads active immutable quote');
select is((select count(*) from public.get_square_payment_quote(
  'f3330000-0000-4000-8000-000000000010', 'wrong-order')), 0::bigint,
  'quote lookup requires exact Square order identity');
select throws_ok($q$select public.finalize_square_card_payment(
  'f3330000-0000-4000-8000-000000000010',
  'f3330000-0000-4000-8000-000000000010', 'order-10', 'payment-10', 901)$q$,
  'P0001', 'square card settlement amount is invalid', 'finalizer enforces Square 90 percent cap');

select * from finish();
rollback;
