-- 0008: reporting views. security_invoker so RLS on the underlying tables
-- keeps deciding who sees which rows -- the views add no new access.

-- Managers need "is Square connected here?" without any access to the token
-- table (which has no client policies at all). security_definer + an explicit
-- brand-staff filter exposes exactly the four harmless columns.
create or replace view public.location_square_status
with (security_barrier) as
select sc.location_id,
       sc.brand_id,
       sc.merchant_id,
       sc.expires_at
from public.square_connections sc
where app.is_brand_staff(sc.brand_id);

-- Revenue counts money the shop actually kept: paid and later, excluding
-- cancelled/refunded. Days are bucketed in the location's own timezone so
-- "yesterday" means the shop's yesterday, not UTC's.
create or replace view public.location_daily_metrics
with (security_invoker = true) as
select
  o.brand_id,
  o.location_id,
  (o.created_at at time zone l.timezone)::date as day,
  count(*) filter (where o.status not in ('created', 'cancelled', 'refunded')) as orders_count,
  coalesce(sum(o.total_cents) filter (where o.status not in ('created', 'cancelled', 'refunded')), 0) as revenue_cents,
  case when count(*) filter (where o.status not in ('created', 'cancelled', 'refunded')) = 0 then 0
       else (coalesce(sum(o.total_cents) filter (where o.status not in ('created', 'cancelled', 'refunded')), 0)
             / count(*) filter (where o.status not in ('created', 'cancelled', 'refunded')))
  end as aov_cents,
  -- In-app share: revenue arriving through the platform's own channels.
  case when coalesce(sum(o.total_cents) filter (where o.status not in ('created', 'cancelled', 'refunded')), 0) = 0 then 0
       else round(
         coalesce(sum(o.total_cents) filter (where o.channel in ('app', 'web')
                                              and o.status not in ('created', 'cancelled', 'refunded')), 0)::numeric
         / sum(o.total_cents) filter (where o.status not in ('created', 'cancelled', 'refunded'))::numeric, 4)
  end as in_app_share,
  case when count(*) filter (where o.status not in ('created', 'cancelled', 'refunded')) = 0 then 0
       else round(
         count(*) filter (where o.loyalty_redeemed_points > 0
                           and o.status not in ('created', 'cancelled', 'refunded'))::numeric
         / count(*) filter (where o.status not in ('created', 'cancelled', 'refunded'))::numeric, 4)
  end as loyalty_redemption_rate
from public.orders o
join public.locations l on l.id = o.location_id
group by o.brand_id, o.location_id, (o.created_at at time zone l.timezone)::date;

create or replace view public.brand_daily_metrics
with (security_invoker = true) as
select
  brand_id,
  day,
  sum(orders_count) as orders_count,
  sum(revenue_cents) as revenue_cents,
  case when sum(orders_count) = 0 then 0 else sum(revenue_cents) / sum(orders_count) end as aov_cents,
  case when sum(revenue_cents) = 0 then 0
       else round(sum(in_app_share * revenue_cents) / sum(revenue_cents)::numeric, 4) end as in_app_share,
  case when sum(orders_count) = 0 then 0
       else round(sum(loyalty_redemption_rate * orders_count) / sum(orders_count)::numeric, 4) end as loyalty_redemption_rate
from public.location_daily_metrics
group by brand_id, day;

-- Drop performance: orders whose snapshot contains the drop's item while the
-- drop was live. Feeds the HQ dashboard's drop card and the weekly report.
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
left join public.orders o
  on o.brand_id = d.brand_id
  and o.created_at between d.starts_at and d.ends_at
  and o.status not in ('created', 'cancelled', 'refunded')
  and o.totals -> 'lines' @> jsonb_build_array(jsonb_build_object('item_id', d.item_id::text))
group by d.brand_id, d.id, d.item_id, d.starts_at, d.ends_at, d.status;
