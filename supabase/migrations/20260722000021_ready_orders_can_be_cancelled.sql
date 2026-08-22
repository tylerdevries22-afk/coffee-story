-- 0021: an order nobody comes to collect can leave the board.
--
-- 'ready' led only to 'picked_up' or 'refunded'. For a card order that is
-- workable -- refund it and the state moves -- but the tender that is live
-- today is pay_at_pickup, which never charged a card through the platform,
-- so refundOrderPayment refuses it by design ("refund it at the register").
-- A drink made for someone who never showed up therefore had no legal move
-- at all: it sat in the Ready column of every KDS in the shop, forever,
-- and every attempt to clear it raised "illegal order transition".
--
-- OPERATOR_TRANSITIONS already advertised 'cancelled' as something the shop
-- floor may write, and the RLS policy already permits the insert. Only the
-- machine disagreed.

create or replace function app.order_transition_allowed(from_status app.order_status, to_status app.order_status)
returns boolean language sql immutable as $$
  select (from_status, to_status) in (
    ('created'::app.order_status,     'paid'::app.order_status),
    ('created'::app.order_status,     'cancelled'::app.order_status),
    ('paid'::app.order_status,        'in_progress'::app.order_status),
    ('paid'::app.order_status,        'cancelled'::app.order_status),
    ('paid'::app.order_status,        'refunded'::app.order_status),
    ('in_progress'::app.order_status, 'ready'::app.order_status),
    ('in_progress'::app.order_status, 'cancelled'::app.order_status),
    ('in_progress'::app.order_status, 'refunded'::app.order_status),
    ('ready'::app.order_status,       'picked_up'::app.order_status),
    ('ready'::app.order_status,       'cancelled'::app.order_status),
    ('ready'::app.order_status,       'refunded'::app.order_status),
    ('picked_up'::app.order_status,   'refunded'::app.order_status)
  )
$$;
