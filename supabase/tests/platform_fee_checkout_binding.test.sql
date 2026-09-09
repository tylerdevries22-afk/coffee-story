begin;
create extension if not exists pgtap with schema extensions;
set search_path = extensions, public, pg_catalog;
select plan(38);

insert into public.brands (id, slug, name) values
  ('f2222222-2222-4222-8222-222222222222', 'fee-link-fencing', 'Fee Link Fencing');
insert into public.locations (id, brand_id, name) values
  ('f2220000-0000-4000-8000-000000000001',
   'f2222222-2222-4222-8222-222222222222', 'Link Location');
insert into public.orders (
  id, brand_id, location_id, status, tender_type, subtotal_cents, total_cents,
  square_checkout_url, square_payment_link_id, square_order_id
)
select ('f2220000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  'f2222222-2222-4222-8222-222222222222',
  'f2220000-0000-4000-8000-000000000001',
  case when n = 4 then 'cancelled'::app.order_status else 'created'::app.order_status end,
  case when n = 3 then 'external' else 'square_link' end, 1000, 1000,
  case when n in (6, 8, 10) then 'https://checkout.example/' || n end,
  case when n in (6, 10) then 'link-' || n end,
  case when n in (6, 7, 10, 11) then 'order-' || n end
from generate_series(1, 13) n;
insert into public.platform_fee_quotes (
  order_id, brand_id, location_id, month_start, month_end, gross_cents,
  fee_cents, fee_bps_applied, expires_at, cleanup_claimed_at, claim_generation
)
select id, brand_id, location_id, date_trunc('month', now()),
  date_trunc('month', now()) + interval '1 month', 1000, 30, 300,
  case when id in (
    'f2220000-0000-4000-8000-000000000009'::uuid,
    'f2220000-0000-4000-8000-000000000010'::uuid,
    'f2220000-0000-4000-8000-000000000011'::uuid,
    'f2220000-0000-4000-8000-000000000012'::uuid)
    then now() - interval '1 second' else now() + interval '1 hour' end,
  case when id = 'f2220000-0000-4000-8000-000000000005'::uuid then now() end,
  id
from public.orders where brand_id = 'f2222222-2222-4222-8222-222222222222';

select is(public.bind_square_checkout_link(
  'f2220000-0000-4000-8000-000000000001', 'f2220000-0000-4000-8000-000000000001',
  'https://checkout.example/valid', 'link-valid', 'order-valid'), true,
  'an active owner binds the complete hosted identity');
select results_eq($q$select square_checkout_url, square_payment_link_id, square_order_id
  from public.orders where id = 'f2220000-0000-4000-8000-000000000001'$q$,
  $$values ('https://checkout.example/valid'::text, 'link-valid'::text, 'order-valid'::text)$$,
  'hosted identity is persisted before returning');
select is(public.bind_square_checkout_link(
  'f2220000-0000-4000-8000-000000000001', 'f2220000-0000-4000-8000-000000000001',
  'https://checkout.example/valid', 'link-valid', 'order-valid'), true,
  'exact hosted binding replay is idempotent');
select is(public.bind_square_checkout_link(
  'f2220000-0000-4000-8000-000000000002', 'f2220000-0000-4000-8000-999999999999',
  'https://checkout.example/stale', 'link-stale', 'order-stale'), false,
  'stale generation cannot bind');
select is(public.bind_square_checkout_link(
  'f2220000-0000-4000-8000-000000000003', 'f2220000-0000-4000-8000-000000000003',
  'https://checkout.example/wrong', 'link-wrong', 'order-wrong'), false,
  'wrong tender cannot bind');
select is(public.bind_square_checkout_link(
  'f2220000-0000-4000-8000-000000000004', 'f2220000-0000-4000-8000-000000000004',
  'https://checkout.example/cancelled', 'link-cancelled', 'order-cancelled'), false,
  'cancelled order cannot bind');
select is(public.bind_square_checkout_link(
  'f2220000-0000-4000-8000-000000000005', 'f2220000-0000-4000-8000-999999999999',
  'https://checkout.example/cleanup', 'link-cleanup', 'order-cleanup'), false,
  'unmatched cleanup ownership fences normal binding');
select is(public.bind_square_checkout_link(
  'f2220000-0000-4000-8000-000000000006', 'f2220000-0000-4000-8000-000000000006',
  'https://checkout.example/6', 'link-6', 'order-6'), true,
  'complete persisted identity replays true');
select is(public.bind_square_checkout_link(
  'f2220000-0000-4000-8000-000000000006', 'f2220000-0000-4000-8000-000000000006',
  'https://checkout.example/changed', 'link-6', 'order-6'), false,
  'conflicting persisted identity is false');
select is(public.bind_square_checkout_link(
  'f2220000-0000-4000-8000-000000000007', 'f2220000-0000-4000-8000-000000000007',
  'https://checkout.example/partial', 'link-partial', 'order-7'), true,
  'compatible partial provider identity is completed');
select is(public.bind_square_checkout_link(
  'f2220000-0000-4000-8000-000000000013', 'f2220000-0000-4000-8000-000000000013',
  'https://checkout.example/duplicate', 'link-6', 'order-6'), false,
  'provider identities cannot move between orders');
select is(public.bind_square_checkout_link(
  'f2220000-0000-4000-8000-000000000099', 'f2220000-0000-4000-8000-000000000099',
  'https://checkout.example/missing', 'link-missing', 'order-missing'), false,
  'missing order and quote returns strict false');

select is(public.bind_square_checkout_link_replay(
  'f2220000-0000-4000-8000-000000000002',
  'https://checkout.example/recovered', 'link-recovered', 'order-recovered'), true,
  'deterministic live replay recovers an all-null provider response');
select is(public.bind_square_checkout_link_replay(
  'f2220000-0000-4000-8000-000000000002',
  'https://checkout.example/recovered', 'link-recovered', 'order-recovered'), true,
  'deterministic response recovery is idempotent');
select is(public.bind_square_checkout_link_replay(
  'f2220000-0000-4000-8000-000000000002',
  'https://checkout.example/recovered', 'link-conflict', 'order-recovered'), false,
  'deterministic replay cannot change an identity');
select is(public.bind_square_checkout_link_replay(
  'f2220000-0000-4000-8000-000000000004',
  'https://checkout.example/nope', 'link-nope', 'order-nope'), false,
  'deterministic replay rejects cancelled orders');
select is(public.bind_square_checkout_link_replay(
  'f2220000-0000-4000-8000-000000000005',
  'https://checkout.example/nope', 'link-nope', 'order-nope'), false,
  'deterministic replay cannot take cleanup ownership');
select throws_ok($q$select public.bind_square_checkout_link_replay(
  'f2220000-0000-4000-8000-000000000008', 'http://bad', 'link-8', 'order-8')$q$,
  'P0001', 'square checkout link identity is invalid', 'replay validates its boundary');

create temporary table claimed_links as
select * from public.claim_due_square_checkout_quotes(now(), 50);
select results_eq('select order_id from claimed_links order by order_id', $$values
  ('f2220000-0000-4000-8000-000000000009'::uuid),
  ('f2220000-0000-4000-8000-000000000010'::uuid),
  ('f2220000-0000-4000-8000-000000000011'::uuid),
  ('f2220000-0000-4000-8000-000000000012'::uuid)$$,
  'cleanup claims expired all-null, partial, and complete hosted attempts');
select ok((select bool_and(claim_generation <> order_id) from claimed_links),
  'cleanup rotates every generation');
select results_eq($q$select gross_cents, quoted_fee_cents, quoted_fee_bps_applied
  from claimed_links where order_id = 'f2220000-0000-4000-8000-000000000009'$q$,
  $$values (1000::bigint, 30::bigint, 300::integer)$$,
  'cleanup receives the immutable quote amounts');
select is((select count(*) from public.claim_due_square_checkout_quotes(now(), 50)),
  0::bigint, 'live cleanup leases are not stolen');
select is(public.bind_square_checkout_link(
  'f2220000-0000-4000-8000-000000000009',
  (select claim_generation from claimed_links where order_id = 'f2220000-0000-4000-8000-000000000009'),
  'https://checkout.example/9', 'link-9', 'order-9'), true,
  'cleanup owner can bind a deterministically replayed all-null response');
select is(public.bind_square_checkout_link(
  'f2220000-0000-4000-8000-000000000011',
  (select claim_generation from claimed_links where order_id = 'f2220000-0000-4000-8000-000000000011'),
  'https://checkout.example/11', 'link-11', 'order-11'), true,
  'cleanup owner completes a partial identity');
select is(public.expire_square_checkout_quote(
  'f2220000-0000-4000-8000-000000000009',
  'f2220000-0000-4000-8000-000000000009', 'link-9', 'order-9', 4, 'CANCELED'), false,
  'stale cleanup generation cannot expire hosted payment');
select is(public.expire_square_checkout_quote(
  'f2220000-0000-4000-8000-000000000009',
  (select claim_generation from claimed_links where order_id = 'f2220000-0000-4000-8000-000000000009'),
  'link-wrong', 'order-9', 4, 'CANCELED'), false,
  'expiry requires exact payment-link identity');
select throws_ok($q$select public.expire_square_checkout_quote(
  'f2220000-0000-4000-8000-000000000009',
  (select claim_generation from claimed_links where order_id = 'f2220000-0000-4000-8000-000000000009'),
  'link-9', 'order-9', 4, 'OPEN')$q$,
  'P0001', 'square checkout expiry evidence is invalid', 'nonterminal provider state is rejected');
select is(public.expire_square_checkout_quote(
  'f2220000-0000-4000-8000-000000000009',
  (select claim_generation from claimed_links where order_id = 'f2220000-0000-4000-8000-000000000009'),
  'link-9', 'order-9', 4, 'CANCELED'), true,
  'exact cleanup owner records provider-cancelled expiry');
select is((select status::text from public.orders
  where id = 'f2220000-0000-4000-8000-000000000009'), 'cancelled',
  'hosted expiry atomically cancels the local order');
select is((select count(*) from public.platform_fee_quotes
  where order_id = 'f2220000-0000-4000-8000-000000000009'), 0::bigint,
  'hosted expiry removes its quote');
select results_eq($q$select square_checkout_url, square_payment_link_id, square_order_id
  from public.orders where id = 'f2220000-0000-4000-8000-000000000009'$q$,
  $$values (null::text, null::text, 'order-9'::text)$$,
  'hosted expiry clears chargeable link identity and retains order history');
select results_eq($q$select provider_order_version, provider_order_state, terminal_reason
  from app_private.square_attempt_terminal_evidence
  where order_id = 'f2220000-0000-4000-8000-000000000009'$q$,
  $$values (4::bigint, 'CANCELED'::text, 'hosted_checkout_expired'::text)$$,
  'hosted expiry retains immutable provider terminal evidence');
select is(public.expire_square_checkout_quote(
  'f2220000-0000-4000-8000-000000000010',
  (select claim_generation from claimed_links where order_id = 'f2220000-0000-4000-8000-000000000010'),
  'link-10', 'order-10', 5, 'CANCELED'), true,
  'complete hosted attempt also expires safely');
select is((select count(*) from public.platform_fee_quotes
  where order_id = 'f2220000-0000-4000-8000-000000000012'), 1::bigint,
  'unreconciled all-null response remains leased, not deleted');
select throws_ok('select * from public.claim_due_square_checkout_quotes(now(), 0)',
  'P0001', 'invalid Square checkout cleanup claim inputs', 'zero batch is rejected');
select throws_ok($q$select public.expire_square_checkout_quote(
  'f2220000-0000-4000-8000-000000000011',
  (select claim_generation from claimed_links where order_id = 'f2220000-0000-4000-8000-000000000011'),
  'link-11', 'order-11', -1, 'CANCELED')$q$,
  'P0001', 'square checkout expiry evidence is invalid', 'provider version is validated');

delete from public.platform_fee_quotes where order_id = 'f2220000-0000-4000-8000-000000000001';
insert into public.platform_fees (
  brand_id, location_id, order_id, gross_cents, fee_cents, fee_bps_applied, square_payment_id
) values ('f2222222-2222-4222-8222-222222222222',
  'f2220000-0000-4000-8000-000000000001',
  'f2220000-0000-4000-8000-000000000001', 1000, 30, 300, 'paid-link-payment');
insert into public.order_events (brand_id, order_id, type, source)
values ('f2222222-2222-4222-8222-222222222222',
  'f2220000-0000-4000-8000-000000000001', 'paid', 'system');
select is(public.bind_square_checkout_link(
  'f2220000-0000-4000-8000-000000000001', 'f2220000-0000-4000-8000-999999999999',
  'https://checkout.example/valid', 'link-valid', 'order-valid'), true,
  'exact persisted replay succeeds after finalization cleanup');
delete from public.platform_fee_quotes where order_id = 'f2220000-0000-4000-8000-000000000006';
select is(public.bind_square_checkout_link(
  'f2220000-0000-4000-8000-000000000006', 'f2220000-0000-4000-8000-999999999999',
  'https://checkout.example/6', 'link-6', 'order-6'), false,
  'quote loss without a durable fee receipt is not a successful replay');

select * from finish();
rollback;
