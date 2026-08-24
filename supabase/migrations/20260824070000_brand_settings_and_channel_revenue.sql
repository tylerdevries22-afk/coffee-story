-- Stage 7: complete HQ's settings write and show revenue by order channel.

create or replace function app.set_brand_settings_config(
  config jsonb,
  expected_updated_at timestamptz default null
)
returns timestamptz
language plpgsql
security invoker
set search_path = public, app
as $$
declare
  target public.brands%rowtype;
  allowed constant text[] := array['tokens', 'copy', 'features', 'board'];
begin
  if jsonb_typeof(config) is distinct from 'object'
     or exists (select 1 from jsonb_object_keys(config) as keys(key) where not key = any(allowed)) then
    raise exception 'brand settings contain an unsupported section';
  end if;
  if pg_column_size(config) > 16384 then
    raise exception 'brand_config_too_large';
  end if;
  if exists (
    select 1 from jsonb_each(config) section
    where jsonb_typeof(section.value) is distinct from 'object'
  ) then
    raise exception 'brand settings sections must be JSON objects';
  end if;

  select * into target from public.brands where id = app.jwt_brand_id();
  if not found then raise exception 'no brand in scope'; end if;
  if expected_updated_at is not null and target.updated_at is distinct from expected_updated_at then
    raise exception 'brand_config_stale';
  end if;

  update public.brands
  set brand_config = jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(brand_config, '{tokens}', coalesce(brand_config -> 'tokens', '{}'::jsonb) || config -> 'tokens'),
        '{copy}', coalesce(brand_config -> 'copy', '{}'::jsonb) || config -> 'copy'
      ),
      '{features}', coalesce(brand_config -> 'features', '{}'::jsonb) || config -> 'features'
    ),
    '{board}', coalesce(brand_config -> 'board', '{}'::jsonb) || config -> 'board'
  )
  where id = target.id
  returning updated_at into target.updated_at;
  return target.updated_at;
end $$;

revoke execute on function app.set_brand_settings_config(jsonb, timestamptz) from anon, public;
grant execute on function app.set_brand_settings_config(jsonb, timestamptz) to authenticated;

create or replace view public.location_daily_metrics
with (security_invoker = true) as
select
  o.brand_id,
  o.location_id,
  (o.created_at at time zone l.timezone)::date as day,
  count(*) filter (where o.status not in ('created', 'cancelled', 'refunded')) as orders_count,
  coalesce(sum(o.total_cents) filter (where o.status not in ('created', 'cancelled', 'refunded')), 0) as revenue_cents,
  case when count(*) filter (where o.status not in ('created', 'cancelled', 'refunded')) = 0 then 0
       else coalesce(sum(o.total_cents) filter (where o.status not in ('created', 'cancelled', 'refunded')), 0)
            / count(*) filter (where o.status not in ('created', 'cancelled', 'refunded')) end as aov_cents,
  case when coalesce(sum(o.total_cents) filter (where o.status not in ('created', 'cancelled', 'refunded')), 0) = 0 then 0
       else round(
         coalesce(sum(o.total_cents) filter (where app.is_owned_channel(o.channel)
           and o.status not in ('created', 'cancelled', 'refunded')), 0)::numeric
         / sum(o.total_cents) filter (where o.status not in ('created', 'cancelled', 'refunded'))::numeric, 4) end as in_app_share,
  case when count(*) filter (where o.status not in ('created', 'cancelled', 'refunded')) = 0 then 0
       else round(count(*) filter (where o.loyalty_redeemed_points > 0
         and o.status not in ('created', 'cancelled', 'refunded'))::numeric
         / count(*) filter (where o.status not in ('created', 'cancelled', 'refunded'))::numeric, 4) end as loyalty_redemption_rate,
  jsonb_build_object(
    'app', coalesce(sum(o.total_cents) filter (where o.channel = 'app' and o.status not in ('created', 'cancelled', 'refunded')), 0),
    'web', coalesce(sum(o.total_cents) filter (where o.channel = 'web' and o.status not in ('created', 'cancelled', 'refunded')), 0),
    'kiosk', coalesce(sum(o.total_cents) filter (where o.channel = 'kiosk' and o.status not in ('created', 'cancelled', 'refunded')), 0),
    'pos', coalesce(sum(o.total_cents) filter (where o.channel = 'pos' and o.status not in ('created', 'cancelled', 'refunded')), 0)
  ) as revenue_by_channel
from public.orders o
join public.locations l on l.id = o.location_id
group by o.brand_id, o.location_id, (o.created_at at time zone l.timezone)::date;

grant select on public.location_daily_metrics to authenticated;
revoke insert, update, delete on public.location_daily_metrics from anon, authenticated;
