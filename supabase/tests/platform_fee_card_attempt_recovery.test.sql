begin;
create extension if not exists pgtap with schema extensions;
set search_path = extensions, public, pg_catalog;
select plan(10);

insert into public.brands (id, slug, name) values
  ('f3777777-7777-4777-8777-777777777777', 'fee-card-recovery', 'Card Recovery');
insert into public.locations (id, brand_id, name) values
  ('f3770000-0000-4000-8000-000000000001',
   'f3777777-7777-4777-8777-777777777777', 'Recovery Location');
insert into public.orders (
  id, brand_id, location_id, status, tender_type, subtotal_cents, total_cents
)
select ('f3770000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  'f3777777-7777-4777-8777-777777777777',
  'f3770000-0000-4000-8000-000000000001',
  case when n = 2 then 'cancelled'::app.order_status else 'created'::app.order_status end,
  'square_card', 1000, 1000 from generate_series(1, 2) n;
insert into public.platform_fee_quotes (
  order_id, brand_id, location_id, month_start, month_end, gross_cents,
  fee_cents, fee_bps_applied, expires_at, claim_generation
)
select id, brand_id, location_id, date_trunc('month', now()),
  date_trunc('month', now()) + interval '1 month', 1000, 30, 300,
  now() - interval '1 second', id from public.orders
where brand_id = 'f3777777-7777-4777-8777-777777777777';

create temporary table recovery_claims as
select * from public.claim_due_square_card_quotes(now(), 50);
select is((select count(*) from recovery_claims), 2::bigint,
  'cleanup leases created and cancelled response-loss attempts');
select ok((select bool_and(claim_generation <> order_id) from recovery_claims),
  'cleanup rotates both generations');
select is(public.bind_square_payment_attempt(
  'f3770000-0000-4000-8000-000000000001',
  'f3770000-0000-4000-8000-000000000001', 'recovered-order-1'), false,
  'pre-cleanup generation cannot bind deterministic replay');
select is(public.bind_square_payment_attempt(
  'f3770000-0000-4000-8000-000000000001',
  (select claim_generation from recovery_claims where order_id =
    'f3770000-0000-4000-8000-000000000001'), 'recovered-order-1'), true,
  'current cleanup owner binds created-order replay');
select is(public.bind_square_payment_attempt(
  'f3770000-0000-4000-8000-000000000002',
  (select claim_generation from recovery_claims where order_id =
    'f3770000-0000-4000-8000-000000000002'), 'recovered-order-2'), true,
  'current cleanup owner binds cancelled-order replay');
select is(public.bind_square_payment_attempt(
  'f3770000-0000-4000-8000-000000000002',
  (select claim_generation from recovery_claims where order_id =
    'f3770000-0000-4000-8000-000000000002'), 'conflict-order'), false,
  'cleanup replay cannot change the durable provider identity');
select is(public.expire_square_card_quote(
  'f3770000-0000-4000-8000-000000000001',
  (select claim_generation from recovery_claims where order_id =
    'f3770000-0000-4000-8000-000000000001'),
  'recovered-order-1', 4, 'CANCELED', null, null), true,
  'cancel-by-key and provider order proof release the created attempt');
select is(public.expire_square_card_quote(
  'f3770000-0000-4000-8000-000000000001',
  (select claim_generation from recovery_claims where order_id =
    'f3770000-0000-4000-8000-000000000001'),
  'recovered-order-1', 4, 'CANCELED', null, null), true,
  'exact terminal expiry replay is idempotent after response loss');
select is(public.expire_square_card_quote(
  'f3770000-0000-4000-8000-000000000001',
  (select claim_generation from recovery_claims where order_id =
    'f3770000-0000-4000-8000-000000000001'),
  'recovered-order-1', 5, 'CANCELED', null, null), false,
  'terminal replay rejects different provider evidence');
select results_eq($q$select status::text, square_order_id from public.orders
  where id = 'f3770000-0000-4000-8000-000000000001'$q$,
  $$values ('cancelled'::text, 'recovered-order-1'::text)$$,
  'cleanup retains provider identity and closes the local order');

select * from finish();
rollback;
