begin;
create extension if not exists pgtap with schema extensions;
set search_path = extensions, public, pg_catalog;
select plan(10);

insert into public.brands (id, slug, name) values
  ('f4455555-5555-4555-8555-555555555555', 'fee-card-reclaim', 'Fee Card Reclaim');
insert into public.locations (id, brand_id, name) values
  ('f4450000-0000-4000-8000-000000000001',
   'f4455555-5555-4555-8555-555555555555', 'Reclaim Location');
insert into public.orders (
  id, brand_id, location_id, status, tender_type, subtotal_cents, total_cents
)
select ('f4450000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  'f4455555-5555-4555-8555-555555555555',
  'f4450000-0000-4000-8000-000000000001',
  case when n = 1 then 'cancelled'::app.order_status else 'created'::app.order_status end,
  case when n = 3 then 'external' else 'square_card' end, 1000, 1000
from generate_series(1, 3) n;
insert into public.platform_fee_quotes (
  order_id, brand_id, location_id, month_start, month_end, gross_cents,
  fee_cents, fee_bps_applied, expires_at, cleanup_claimed_at, claim_generation
)
select id, brand_id, location_id, date_trunc('month', now()),
  date_trunc('month', now()) + interval '1 month', 1000, 30, 300,
  case when id = 'f4450000-0000-4000-8000-000000000002'::uuid
    then now() + interval '1 hour' else now() - interval '1 second' end,
  case when id = 'f4450000-0000-4000-8000-000000000001'::uuid
    then now() - interval '10 minutes' end, id
from public.orders where brand_id = 'f4455555-5555-4555-8555-555555555555';

create temporary table reclaimed_cards as
select * from public.claim_due_square_card_quotes(now(), 50);
select results_eq('select order_id from reclaimed_cards',
  $$values ('f4450000-0000-4000-8000-000000000001'::uuid)$$,
  'only the stale cleanup lease is reclaimed');
select isnt((select claim_generation from reclaimed_cards),
  'f4450000-0000-4000-8000-000000000001'::uuid,
  'cleanup reclamation rotates generation');
select is(public.expire_square_card_quote(
  'f4450000-0000-4000-8000-000000000001',
  'f4450000-0000-4000-8000-000000000001',
  'recovered-order', 4, 'CANCELED', null, null), false, 'prior cleanup owner is stale');
select is(public.bind_square_payment_attempt(
  'f4450000-0000-4000-8000-000000000001',
  (select claim_generation from reclaimed_cards), 'recovered-order'), true,
  'current cleanup owner binds deterministic CreateOrder recovery');
select is(public.expire_square_card_quote(
  'f4450000-0000-4000-8000-000000000001',
  (select claim_generation from reclaimed_cards),
  'recovered-order', 5, 'CANCELED', null, null), true,
  'reclaimed owner finishes provider-cancelled cleanup');
select is((select count(*) from public.order_events where order_id =
  'f4450000-0000-4000-8000-000000000001'), 0::bigint,
  'cleanup does not invent a duplicate cancellation event');
select is((select count(*) from public.platform_fee_quotes where order_id =
  'f4450000-0000-4000-8000-000000000002'), 1::bigint,
  'future card quote is not claimed');
select is((select count(*) from public.platform_fee_quotes where order_id =
  'f4450000-0000-4000-8000-000000000003'), 1::bigint,
  'non-card quote is not claimed');
select throws_ok('select * from public.claim_due_square_card_quotes(now(), 51)',
  'P0001', 'invalid Square card cleanup claim inputs', 'oversized batch is rejected');
select throws_ok($q$select public.expire_square_card_quote(
  'f4450000-0000-4000-8000-000000000002',
  'f4450000-0000-4000-8000-000000000002', null, 1, null, null, null)$q$,
  'P0001', 'square card expiry evidence is invalid', 'partial evidence is rejected');

select * from finish();
rollback;
