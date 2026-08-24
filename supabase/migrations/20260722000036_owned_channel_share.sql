-- 0036: the metric an owner reads as "our own platform" counts the kiosk.
--
-- `in_app_share` (0008) filters on `channel in ('app','web')`. `packages/
-- domain/src/order-channel.ts` landed the argument and the corrected
-- definition -- `isOwnedChannel`, which is true for app, web AND kiosk -- and
-- said it was "exported so the view and the report can be reconciled against
-- one definition instead of a SQL literal". The view was never changed, so
-- there are two definitions and the database still holds the wrong one.
--
-- Why it matters more than a rounding difference: a kiosk is the most owned
-- channel a shop has. Excluding it puts every self-service sale in the
-- denominator and never the numerator, so the number an owner reads as "how
-- much is coming through our own platform" FALLS as more guests use the
-- platform's own hardware. On a franchise dashboard that inverts the ranking
-- between a franchisee who installed kiosks and one who did not.
--
-- `pos` stays out, and that is the real line this metric draws: not "in an
-- app" but "the guest served themselves through our platform" as against
-- "a member of staff rang it up". Renaming the column to match would break the
-- HQ dashboard, the owner's weekly email and the generated types for a word,
-- while three other branches are in flight; the name stays and the meaning is
-- written down here and pinned by a test.

/**
 * One definition of "the shop's own channel", callable from SQL.
 *
 * `isOwnedChannel` in @platform/domain is the same rule for TypeScript. Two
 * languages cannot share one function, so they share one *name* and a test
 * that reads both and fails when they disagree -- which is the closest thing
 * to a single definition that a Postgres view and a bundled app can have.
 */
create or replace function app.is_owned_channel(channel app.order_channel)
returns boolean language sql immutable as $$
  select channel in ('app', 'web', 'kiosk')
$$;

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
  -- Revenue the guest brought through the shop's own channels: the app, the
  -- web storefront, and the kiosk in the lobby. Mirrors app.is_owned_channel
  -- below, which mirrors isOwnedChannel in @platform/domain.
  case when coalesce(sum(o.total_cents) filter (where o.status not in ('created', 'cancelled', 'refunded')), 0) = 0 then 0
       else round(
         coalesce(sum(o.total_cents) filter (where app.is_owned_channel(o.channel)
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

comment on view public.location_daily_metrics is
  'Per-location daily metrics. in_app_share is the share of revenue through '
  'the shop''s OWN channels (app, web, kiosk) rather than rung up by staff '
  'at the till. Read-only aggregate: never grant write privileges on a view.';

grant select on public.location_daily_metrics to authenticated;
revoke insert, update, delete on public.location_daily_metrics from anon, authenticated;
