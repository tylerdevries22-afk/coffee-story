-- 0026: the rotating lineup, and the reveal that precedes it.
--
-- The category's shape is a fixed set of permanent items, a rotating set that
-- changes on a weekly cadence, and sometimes one item tied to a single
-- weekday. Nothing in the schema distinguished those, so "this week's lineup"
-- could not be asked for.
--
-- The reveal is the more interesting half. The lineup becomes *visible* the
-- evening before it becomes *orderable*, and that gap is the most engaging
-- moment in the model -- it is what a countdown counts down to. One timestamp
-- drives three surfaces: the app shows a teaser with no add-to-bag control,
-- the kiosk keeps the item off the menu entirely, and the prep station's bake
-- list stays empty until the window opens.

create type app.item_rotation as enum ('permanent', 'rotating', 'day_specific');

alter table public.menu_items
  add column rotation app.item_rotation not null default 'permanent',
  -- ISO weekday, 1 = Monday. Only meaningful for 'day_specific'.
  add column weekday integer check (weekday between 1 and 7);

alter table public.menu_items
  add constraint menu_items_weekday_only_for_day_specific
  check ((rotation = 'day_specific') = (weekday is not null));

create index menu_items_rotation_idx on public.menu_items (menu_id, rotation);

alter table public.drops
  -- When the lineup becomes visible as a teaser. Null = no separate reveal;
  -- the drop simply appears when it goes live.
  add column reveal_at timestamptz;

alter table public.drops
  add constraint drops_reveal_before_start
  check (reveal_at is null or reveal_at <= starts_at);

-- 'revealed' sits between scheduled and live. The existing check constraint
-- has to be replaced rather than extended.
alter table public.drops drop constraint if exists drops_status_check;
alter table public.drops
  add constraint drops_status_check
  check (status in ('draft', 'scheduled', 'revealed', 'live', 'ended', 'cancelled'));

create index drops_reveal_idx on public.drops (brand_id, reveal_at)
  where reveal_at is not null;

/**
 * What a guest may see, and what they may order, at a given moment.
 *
 * Kept in SQL because three clients ask the same question and a disagreement
 * between them is exactly the bug this prevents: a kiosk listing something the
 * app calls upcoming, or a prep board baking for a window that has not opened.
 */
create or replace function app.drop_visibility(d public.drops, at_time timestamptz default now())
returns text
language sql stable as $$
  select case
    when d.status in ('draft', 'cancelled') then 'hidden'
    when at_time >= d.starts_at and at_time < d.ends_at then 'orderable'
    when at_time >= d.ends_at then 'ended'
    when d.reveal_at is not null and at_time >= d.reveal_at then 'revealed'
    else 'hidden'
  end
$$;
