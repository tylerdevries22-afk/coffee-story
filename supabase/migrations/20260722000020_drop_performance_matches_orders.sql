-- 0020: drop_performance can actually find the orders it counts.
--
-- The join asked whether an order's cart snapshot contained an item_id:
--
--   o.totals -> 'lines' @> jsonb_build_array(jsonb_build_object('item_id', d.item_id::text))
--
-- Order snapshots have never carried an item_id. createOrder writes each line
-- as { item_slug, name, quantity, unit_price_cents, options, note } -- and
-- drops.item_id is a uuid pointing at menu_items, while the snapshot stores
-- that item's slug. Two mismatches in one containment test, so it was always
-- false: every drop reported zero orders and zero revenue, on the HQ drop
-- card and in the weekly report, and a zero reads as a drop nobody wanted
-- rather than a query that cannot match.
--
-- The fix joins through menu_items to get the slug the snapshot actually
-- uses, which also makes the number right for orders already placed.

create or replace view public.drop_performance
with (security_invoker = true) as
select
  d.brand_id,
  d.id as drop_id,
  d.item_id,
  d.starts_at,
  d.ends_at,
  d.status,
  count(o.id) as orders_count,
  coalesce(sum(o.total_cents), 0) as revenue_cents
from public.drops d
left join public.menu_items mi on mi.id = d.item_id
left join public.orders o
  on o.brand_id = d.brand_id
  and o.created_at between d.starts_at and d.ends_at
  and o.status not in ('created', 'cancelled', 'refunded')
  and mi.slug is not null
  and o.totals -> 'lines' @> jsonb_build_array(jsonb_build_object('item_slug', mi.slug))
group by d.brand_id, d.id, d.item_id, d.starts_at, d.ends_at, d.status;
