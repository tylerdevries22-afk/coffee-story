-- 0017: where a hosted checkout link lives.
--
-- The square_link tender mints a Square-hosted page and hands its URL to the
-- app. Keeping the URL on the order (rather than only in the response) means
-- a guest who closes the tab -- or opens the order on another device -- can
-- be sent back to the same page instead of minting a second one, and it makes
-- the mint idempotent: an order that already has a link never asks for
-- another. Square expires the page itself; the column is advisory, never a
-- source of order state (rule 2: only order_events moves status).

alter table public.orders
  add column if not exists square_checkout_url text;

comment on column public.orders.square_checkout_url is
  'Square-hosted checkout page for the square_link tender. Never authoritative for payment state -- the webhook is.';
