-- 0030: two loyalty defects that only appear once Square is delivering
-- webhooks.
--
-- 1. One order could EARN twice. 0018 added `loyalty_events_one_reverse_per_
--    order` so a retried refund delivery reverses once, but nothing matched it
--    on the earn side -- the only earn index (0012) is not unique. The webhook
--    route decides "new delivery" from `square_event_id` alone, and the order
--    trigger (0011) deliberately records an idempotent re-assertion as a new
--    event and moves nothing. So a second `payment.updated` for the same
--    payment, still COMPLETED, with a different event id, inserted an event,
--    reported itself new, and awarded the whole earn again: a $22.50 order
--    credited 450 points instead of 225. `platform_fees` survives the same
--    delivery only because `square_payment_id` is UNIQUE.
--
-- 2. Only the FIRST partial refund could reverse anything. One reversal per
--    order, ever, is right for a retry and wrong for a second refund: a $50
--    order earning 500 points, refunded $10 then the remaining $40, reversed
--    100 and then hit the constraint and reversed 0 -- the guest kept 400
--    points on a fully refunded order, and two half-refunds disagreed with one
--    full refund about the same money.
--
-- The reversal key is the cause, not the order: the Square event id, or the
-- cancellation. A retry of one refund carries the same key and is refused; a
-- genuinely different refund carries a different one and is allowed, with the
-- engine capping the running total at what was earned.

drop index if exists public.loyalty_events_one_reverse_per_order;

-- `note` is `not null default ''`, so legacy reversals sit at '' and a new
-- unkeyed reversal still collides with them -- the old guarantee, kept.
create unique index if not exists loyalty_events_one_reverse_per_cause
  on public.loyalty_events (order_id, note)
  where type = 'reverse';

-- Repair rows created before earn idempotency existed. Removing only the
-- duplicate ledger rows would leave their points in the projection forever,
-- so reconcile both balances before adding the constraint.
create temporary table loyalty_earn_duplicates on commit drop as
select id, account_id, points
from (
  select id, account_id, points,
         row_number() over (partition by order_id order by created_at, id) as ordinal
  from public.loyalty_events
  where type = 'earn' and order_id is not null
) ranked
where ordinal > 1;

update public.loyalty_accounts account
set points_balance = greatest(0, account.points_balance - duplicate.points),
    lifetime_points = greatest(0, account.lifetime_points - duplicate.points),
    updated_at = now()
from (
  select account_id, sum(points) as points
  from loyalty_earn_duplicates
  group by account_id
) duplicate
where account.id = duplicate.account_id;

delete from public.loyalty_events event
using loyalty_earn_duplicates duplicate
where event.id = duplicate.id;

create unique index if not exists loyalty_events_one_earn_per_order
  on public.loyalty_events (order_id)
  where type = 'earn';
