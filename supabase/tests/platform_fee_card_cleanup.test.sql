begin;
create extension if not exists pgtap with schema extensions;
set search_path = extensions, public, pg_catalog;
select plan(29);

insert into public.brands (id, slug, name) values
  ('f4444444-4444-4444-8444-444444444444', 'fee-card-cleanup', 'Fee Card Cleanup');
insert into public.locations (id, brand_id, name) values
  ('f4440000-0000-4000-8000-000000000001',
   'f4444444-4444-4444-8444-444444444444', 'Cleanup Location');
insert into public.orders (
  id, brand_id, location_id, status, tender_type, subtotal_cents, total_cents,
  square_order_id, square_payment_id
)
select ('f4440000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  'f4444444-4444-4444-8444-444444444444',
  'f4440000-0000-4000-8000-000000000001',
  'created'::app.order_status, 'square_card', 1000, 1000,
  case when n between 2 and 5 then 'cleanup-order-' || n end,
  case when n between 3 and 5 then 'cleanup-payment-' || n end
from generate_series(1, 5) n;
insert into public.platform_fee_quotes (
  order_id, brand_id, location_id, month_start, month_end, gross_cents,
  fee_cents, fee_bps_applied, expires_at, claim_generation
)
select id, brand_id, location_id, date_trunc('month', now()),
  date_trunc('month', now()) + interval '1 month', 1000, 30, 300,
  now() - interval '1 second',
  id
from public.orders where brand_id = 'f4444444-4444-4444-8444-444444444444';

create temporary table claimed_cards as
select * from public.claim_due_square_card_quotes(now(), 50);
select results_eq('select order_id from claimed_cards order by order_id', $$values
  ('f4440000-0000-4000-8000-000000000001'::uuid),
  ('f4440000-0000-4000-8000-000000000002'::uuid),
  ('f4440000-0000-4000-8000-000000000003'::uuid),
  ('f4440000-0000-4000-8000-000000000004'::uuid),
  ('f4440000-0000-4000-8000-000000000005'::uuid)$$,
  'cleanup claims every expired card quote');
select ok((select bool_and(claim_generation <> order_id) from claimed_cards),
  'every cleanup claim rotates generation');
select results_eq($q$select square_order_id, square_payment_id, gross_cents,
    quoted_fee_cents, quoted_fee_bps_applied from claimed_cards
  where order_id = 'f4440000-0000-4000-8000-000000000003'$q$,
  $$values ('cleanup-order-3'::text, 'cleanup-payment-3'::text,
    1000::bigint, 30::bigint, 300::integer)$$,
  'maintenance receives exact provider and fee identities');
select is((select count(*) from public.claim_due_square_card_quotes(now(), 50)),
  0::bigint, 'live cleanup leases are not replayed');
select is(public.expire_square_card_quote(
  'f4440000-0000-4000-8000-000000000001',
  'f4440000-0000-4000-8000-000000000001',
  'cleanup-order-1', 1, 'CANCELED', null, null), false,
  'stale cleanup generation cannot expire an unbound quote');
select throws_ok($q$select public.expire_square_card_quote(
  'f4440000-0000-4000-8000-000000000002',
  (select claim_generation from claimed_cards
    where order_id = 'f4440000-0000-4000-8000-000000000002'),
  'cleanup-order-2', 7, 'OPEN', null, null)$q$,
  'P0001', 'square card expiry evidence is invalid',
  'an open provider order is not terminal proof');
select is(public.expire_square_card_quote(
  'f4440000-0000-4000-8000-000000000002',
  (select claim_generation from claimed_cards
    where order_id = 'f4440000-0000-4000-8000-000000000002'),
  'cleanup-order-wrong', 7, 'CANCELED', null, null), false,
  'provider terminal proof must match the durable order');
select is(public.bind_square_payment_attempt(
  'f4440000-0000-4000-8000-000000000001',
  (select claim_generation from claimed_cards
    where order_id = 'f4440000-0000-4000-8000-000000000001'),
  'cleanup-order-1'), true,
  'cleanup recovers and durably binds a lost CreateOrder response');
select is(public.expire_square_card_quote(
  'f4440000-0000-4000-8000-000000000001',
  (select claim_generation from claimed_cards
    where order_id = 'f4440000-0000-4000-8000-000000000001'),
  'cleanup-order-1', 6, 'CANCELED', null, null), true,
  'cancel-by-key and versioned order proof release the recovered attempt');
select is((select status::text from public.orders
  where id = 'f4440000-0000-4000-8000-000000000001'), 'cancelled',
  'unbound cleanup atomically cancels the local order');
select is((select count(*) from public.platform_fee_quotes
  where order_id = 'f4440000-0000-4000-8000-000000000001'), 0::bigint,
  'unbound cleanup removes the reservation');
select is((select count(*) from app_private.square_attempt_terminal_evidence
  where order_id = 'f4440000-0000-4000-8000-000000000001'), 1::bigint,
  'recovered cleanup retains permanent-key terminal evidence');

select is(public.expire_square_card_quote(
  'f4440000-0000-4000-8000-000000000002',
  (select claim_generation from claimed_cards
    where order_id = 'f4440000-0000-4000-8000-000000000002'),
  'cleanup-order-2', 7, 'CANCELED', null, null), true,
  'cancel-by-key plus versioned provider cancellation expires a bound attempt');
select results_eq($q$select square_order_id, payment_idempotency_key,
    provider_order_version, provider_order_state, terminal_reason
  from app_private.square_attempt_terminal_evidence
  where order_id = 'f4440000-0000-4000-8000-000000000002'$q$,
  $$values ('cleanup-order-2'::text,
    'pay-f4440000-0000-4000-8000-000000000002'::text,
    7::bigint, 'CANCELED'::text, 'card_attempt_expired'::text)$$,
  'bound attempt expiry retains permanent-key terminal evidence');
select is((select square_order_id from public.orders
  where id = 'f4440000-0000-4000-8000-000000000002'), 'cleanup-order-2',
  'bound attempt expiry retains provider order history');
select is(public.bind_square_payment_attempt(
  'f4440000-0000-4000-8000-000000000002',
  (select claim_generation from claimed_cards
    where order_id = 'f4440000-0000-4000-8000-000000000002'),
  'cleanup-order-2'), false, 'terminal attempt cannot resume a provider charge');

select throws_ok($q$select public.expire_square_card_quote(
  'f4440000-0000-4000-8000-000000000003',
  (select claim_generation from claimed_cards
    where order_id = 'f4440000-0000-4000-8000-000000000003'),
  'cleanup-order-3', 8, 'CANCELED', 'cleanup-payment-3', 'COMPLETED')$q$,
  'P0001', 'square card expiry evidence is invalid',
  'completed payment must reconcile instead of expire');
select is(public.expire_square_card_quote(
  'f4440000-0000-4000-8000-000000000003',
  (select claim_generation from claimed_cards
    where order_id = 'f4440000-0000-4000-8000-000000000003'),
  'cleanup-order-3', 8, 'CANCELED', 'cleanup-payment-3', 'FAILED'), true,
  'failed provider payment releases the reservation');
select results_eq($q$select square_payment_id, provider_payment_state, terminal_reason
  from app_private.square_attempt_terminal_evidence
  where order_id = 'f4440000-0000-4000-8000-000000000003'$q$,
  $$values ('cleanup-payment-3'::text, 'FAILED'::text, 'card_payment_terminal'::text)$$,
  'failed payment identity and terminal outcome remain durable');
select is(public.bind_square_payment(
  'f4440000-0000-4000-8000-000000000003',
  (select claim_generation from claimed_cards where order_id =
    'f4440000-0000-4000-8000-000000000003'),
  'cleanup-order-3', 'cleanup-payment-3'), false,
  'terminal payment outcome cannot replay as a successful binding');
select is(public.expire_square_card_quote(
  'f4440000-0000-4000-8000-000000000004',
  (select claim_generation from claimed_cards
    where order_id = 'f4440000-0000-4000-8000-000000000004'),
  'cleanup-order-4', 9, 'CANCELED', 'cleanup-payment-4', 'CANCELED'), true,
  'cancelled provider payment releases the reservation');
select is((select provider_payment_state
  from app_private.square_attempt_terminal_evidence
  where order_id = 'f4440000-0000-4000-8000-000000000004'), 'CANCELED',
  'cancelled provider payment outcome remains durable');
select is(public.record_square_payment_settlement(
  'f4440000-0000-4000-8000-000000000003', 'late-event-3',
  'cleanup-order-3', 'cleanup-payment-3', 30, 'payment.updated'), true,
  'an exact delayed completion is recorded for automatic remediation');
select is((select count(*) from public.platform_fees
  where order_id = 'f4440000-0000-4000-8000-000000000003'), 1::bigint,
  'delayed completion retains the collected fee receipt');

select throws_ok($q$select public.expire_square_card_quote(
  'f4440000-0000-4000-8000-000000000005', (select claim_generation from claimed_cards
  where order_id = 'f4440000-0000-4000-8000-000000000005'), 'cleanup-order-5', 10,
  'CANCELED', 'cleanup-payment-5', null)$q$, 'P0001', 'square card expiry evidence is invalid',
  'a bound payment requires explicit terminal payment state');
select is((select count(*) from public.platform_fee_quotes where order_id =
  'f4440000-0000-4000-8000-000000000005'), 1::bigint, 'invalid evidence preserves quote');
select is(public.record_square_payment_settlement(
  'f4440000-0000-4000-8000-000000000005', 'completed-event-5',
  'cleanup-order-5', 'cleanup-payment-5', 30, 'payment.updated'), true,
  'completed payment reconciles while current cleanup lease is held');
select is((select status::text from public.orders
  where id = 'f4440000-0000-4000-8000-000000000005'), 'paid',
  'cleanup reconciliation records paid state');
select is((select count(*) from public.platform_fee_quotes
  where order_id = 'f4440000-0000-4000-8000-000000000005'), 0::bigint,
  'cleanup reconciliation removes finalized quote');

select * from finish();
rollback;
