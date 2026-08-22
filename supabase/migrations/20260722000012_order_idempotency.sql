-- 0012: closes the double-charge window and indexes the hot paths the audit
-- found bare.
--
-- placeOrder previously accepted no client key: a retried checkout (timeout,
-- flaky network, double-tap past the UI guard) inserted a second orders row,
-- and because Square idempotency keys derive from the order id, a second
-- charge. The client now sends one key per checkout attempt; the engine
-- returns the existing order on conflict.

alter table public.orders
  add column client_key uuid,
  add column tender_type text not null default 'external'
    check (tender_type in ('pay_at_pickup', 'external', 'square_link', 'square_card'));

create unique index orders_client_key_idx on public.orders (brand_id, client_key)
  where client_key is not null;

-- Every Square webhook delivery looked the order up by square_order_id /
-- square_payment_id with no index (sequential scan per delivery) and no
-- uniqueness (maybeSingle() throws on the first duplicate).
create unique index orders_square_order_idx on public.orders (square_order_id)
  where square_order_id is not null;
create unique index orders_square_payment_idx on public.orders (square_payment_id)
  where square_payment_id is not null;

-- The refund-reversal lookup (loyalty events for an order) and every RLS
-- branch that resolves a customer by auth.uid().
create index loyalty_events_order_idx on public.loyalty_events (order_id, type)
  where order_id is not null;
create index customers_user_idx on public.customers (user_id) where user_id is not null;
create index platform_fees_order_idx on public.platform_fees (order_id) where order_id is not null;
