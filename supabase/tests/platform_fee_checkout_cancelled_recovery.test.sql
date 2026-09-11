begin;
create extension if not exists pgtap with schema extensions;
set search_path = extensions, public, pg_catalog;
select plan(14);

insert into public.brands (id, slug, name) values
  ('f2777777-7777-4777-8777-777777777777', 'fee-link-cancelled', 'Link Recovery');
insert into public.locations (id, brand_id, name) values
  ('f2770000-0000-4000-8000-000000000001',
   'f2777777-7777-4777-8777-777777777777', 'Recovery Location');

insert into public.square_connections (
  id, brand_id, location_id, merchant_id, square_location_id,
  access_token_encrypted, refresh_token_encrypted, expires_at
)
select gen_random_uuid(), loc.brand_id, loc.id, 'merchant-test', 'square-test',
  'ciphertext-access', 'ciphertext-refresh', now() + interval '1 hour'
from public.locations loc
where not exists (
  select 1 from public.square_connections c where c.location_id = loc.id
);

insert into public.orders (
  id, brand_id, location_id, status, tender_type, subtotal_cents, total_cents
) values ('f2770000-0000-4000-8000-000000000001',
  'f2777777-7777-4777-8777-777777777777',
  'f2770000-0000-4000-8000-000000000001', 'cancelled', 'square_link', 1000, 1000);
insert into public.platform_fee_quotes (
  order_id, brand_id, location_id, month_start, month_end, gross_cents,
  fee_cents, fee_bps_applied, expires_at, claim_generation
) values ('f2770000-0000-4000-8000-000000000001',
  'f2777777-7777-4777-8777-777777777777',
  'f2770000-0000-4000-8000-000000000001', date_trunc('month', now()),
  date_trunc('month', now()) + interval '1 month', 1000, 30, 300,
  now() - interval '1 second', 'f2770000-0000-4000-8000-000000000001');

create temporary table cancelled_claim as
select * from public.claim_due_square_checkout_quotes(now(), 50);
select is((select order_id from cancelled_claim),
  'f2770000-0000-4000-8000-000000000001'::uuid,
  'cleanup leases cancelled hosted order with an incomplete provider identity');
select isnt((select claim_generation from cancelled_claim),
  'f2770000-0000-4000-8000-000000000001'::uuid, 'cleanup rotates generation');
select is(public.bind_square_checkout_link(
  'f2770000-0000-4000-8000-000000000001',
  'f2770000-0000-4000-8000-000000000001',
  'https://checkout.example/recovered', 'recovered-link', 'recovered-order'), false,
  'pre-cleanup generation cannot bind a recovered provider response');
select is(public.bind_square_checkout_link(
  'f2770000-0000-4000-8000-000000000001',
  (select claim_generation from cancelled_claim),
  'https://checkout.example/recovered', 'recovered-link', 'recovered-order'), true,
  'current cleanup owner completes provider identity on a cancelled order');
select results_eq($q$select square_payment_link_id, square_order_id from public.orders
  where id = 'f2770000-0000-4000-8000-000000000001'$q$,
  $$values ('recovered-link'::text, 'recovered-order'::text)$$,
  'recovered identity is durable before provider cleanup');
select is(public.expire_square_checkout_quote(
  'f2770000-0000-4000-8000-000000000001',
  (select claim_generation from cancelled_claim), 'recovered-link', 'recovered-order',
  11, 'CANCELED'), true, 'terminal provider proof finishes cancelled-order cleanup');
select is(public.expire_square_checkout_quote(
  'f2770000-0000-4000-8000-000000000001',
  (select claim_generation from cancelled_claim), 'recovered-link', 'recovered-order',
  11, 'CANCELED'), true, 'exact hosted expiry replay is idempotent');
select is(public.expire_square_checkout_quote(
  'f2770000-0000-4000-8000-000000000001',
  (select claim_generation from cancelled_claim), 'recovered-link', 'recovered-order',
  12, 'CANCELED'), false, 'hosted expiry replay rejects changed evidence');
select results_eq($q$select count(*)::bigint,
    (select count(*) from app_private.square_attempt_terminal_evidence where order_id =
      'f2770000-0000-4000-8000-000000000001')::bigint
  from public.platform_fee_quotes where order_id =
    'f2770000-0000-4000-8000-000000000001'$q$,
  $$values (0::bigint, 1::bigint)$$, 'cleanup removes only the quote and retains evidence');
select is((select count(*) from public.order_events where order_id =
  'f2770000-0000-4000-8000-000000000001'), 0::bigint,
  'cancelled-order cleanup does not invent another event');

insert into public.orders (
  id, brand_id, location_id, status, tender_type, subtotal_cents, total_cents
) values ('f2770000-0000-4000-8000-000000000002',
  'f2777777-7777-4777-8777-777777777777',
  'f2770000-0000-4000-8000-000000000001', 'created', 'square_link', 1000, 1000);
insert into public.platform_fee_quotes (
  order_id, brand_id, location_id, month_start, month_end, gross_cents,
  fee_cents, fee_bps_applied, expires_at, claim_generation
) values ('f2770000-0000-4000-8000-000000000002',
  'f2777777-7777-4777-8777-777777777777',
  'f2770000-0000-4000-8000-000000000001', date_trunc('month', now()),
  date_trunc('month', now()) + interval '1 month', 1000, 30, 300,
  now() + interval '1 hour', 'f2770000-0000-4000-8000-000000000002');
select is(public.bind_square_checkout_link(
  'f2770000-0000-4000-8000-000000000002',
  'f2770000-0000-4000-8000-000000000002',
  'https://checkout.example/new', 'recovered-link', 'different-order'), false,
  'terminal hosted link cannot bind to another order');
select is(public.bind_square_checkout_link(
  'f2770000-0000-4000-8000-000000000002',
  'f2770000-0000-4000-8000-000000000002',
  'https://checkout.example/new', 'different-link', 'recovered-order'), false,
  'terminal Square order cannot bind to another order');
select is(public.bind_square_checkout_link_replay(
  'f2770000-0000-4000-8000-000000000002',
  'https://checkout.example/new', 'recovered-link', 'different-order'), false,
  'deterministic replay rejects a terminal hosted link');
select is(public.bind_square_checkout_link_replay(
  'f2770000-0000-4000-8000-000000000002',
  'https://checkout.example/new', 'different-link', 'recovered-order'), false,
  'deterministic replay rejects a terminal Square order');

select * from finish();
rollback;
