-- Demo events: anonymous, demo-scoped screen views from a live demo's own
-- in-app runtime.
--
-- platform_demo_sites already counts the one event that matters most to the
-- outreach loop -- a link opened -- but says nothing about what happened
-- after: whether the prospect actually used the app, or bounced off the
-- landing page. This table is that second signal, one row per screen the
-- guest-app runtime rendered, keyed to the site the httpOnly demo cookie
-- already names. No visitor identity of any kind is stored -- not an IP, not
-- a cookie value, not a session id -- only which site, which screen, and when.
--
-- Service-role only, unlike platform_demo_sites: nothing in the console reads
-- this table directly, only through platform_demo_event_counts below, so it
-- carries no policy at all, not even a platform-admin read. Deleting a site
-- must take its events with it -- the cascade below, not application code, is
-- what keeps a future hard-delete (removal or the expiry sweep) from leaving
-- orphaned rows; both are soft state transitions today, so this is a
-- structural guarantee ahead of that need rather than a change to either.

create table public.platform_demo_events (
  id bigint generated always as identity primary key,
  site_id uuid not null references public.platform_demo_sites (id) on delete cascade,
  -- One value today; a check list (never an enum) costs nothing to extend
  -- later the way `platform_demo_costs.provider` and `.kind` already do.
  event_name text not null default 'screen.viewed' check (event_name in ('screen.viewed')),
  screen text not null check (screen ~ '^[a-z][a-z0-9_]{0,63}$'),
  occurred_at timestamptz not null default now()
);

comment on table public.platform_demo_events is
  'Anonymous screen-view events from a live demo''s own runtime. Service-role '
  'only: read through platform_demo_event_counts, never a direct client query.';

-- Covers the foreign key (leading column) and answers the console's per-site
-- rollup -- count and most recent occurred_at -- from one index instead of a
-- table scan.
create index platform_demo_events_site_id_idx
  on public.platform_demo_events (site_id, occurred_at desc);

alter table public.platform_demo_events enable row level security;

-- No policies: row level security alone would still deny every row to a role
-- with no matching policy, but the table grant is revoked too, so an
-- unprivileged role fails at the privilege check and never reaches RLS.
revoke all on public.platform_demo_events from public, anon, authenticated;
grant all on public.platform_demo_events to service_role;

-- The console's per-site rollup in one call for a page of sites, rather than
-- one query per row. Empty input returns no rows rather than every site's.
create function public.platform_demo_event_counts(p_site_ids uuid[])
returns table (site_id uuid, screen_views bigint, last_viewed_at timestamptz)
language sql stable security invoker set search_path = '' as $$
  select event.site_id, count(*)::bigint, max(event.occurred_at)
    from public.platform_demo_events as event
   where event.site_id = any (coalesce(p_site_ids, '{}'::uuid[]))
   group by event.site_id;
$$;

revoke all on function public.platform_demo_event_counts(uuid[]) from public, anon, authenticated;
grant execute on function public.platform_demo_event_counts(uuid[]) to service_role;

create function app.assert_platform_demo_events()
returns void language plpgsql stable security invoker set search_path = '' as $$
begin
  if exists (
    select 1 from pg_catalog.pg_class relation
    where relation.oid = 'public.platform_demo_events'::regclass and not relation.relrowsecurity
  ) then
    raise exception 'demo events lost row level security';
  end if;
  if exists (
    select 1 from pg_catalog.pg_policies policy_row
    where policy_row.schemaname = 'public' and policy_row.tablename = 'platform_demo_events'
  ) then
    raise exception 'demo events grew a policy meant to stay service-role only';
  end if;
  if exists (
    select 1 from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.platform_demo_events'::regclass
      and constraint_row.contype = 'f'
      and constraint_row.confrelid = 'public.platform_demo_sites'::regclass
      and constraint_row.confdeltype <> 'c'
  ) then
    raise exception 'a removed demo site would leave its events behind';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_indexes index_row
    where index_row.schemaname = 'public' and index_row.tablename = 'platform_demo_events'
      and index_row.indexname = 'platform_demo_events_site_id_idx'
  ) then
    raise exception 'the demo events foreign key has no covering index';
  end if;
  if pg_catalog.has_table_privilege('anon', 'public.platform_demo_events', 'select')
    or pg_catalog.has_table_privilege('authenticated', 'public.platform_demo_events', 'select')
    or pg_catalog.has_function_privilege('authenticated', 'public.platform_demo_event_counts(uuid[])', 'execute')
  then
    raise exception 'demo events are reachable by a client role';
  end if;
end $$;

revoke all on function app.assert_platform_demo_events() from public, anon, authenticated;
grant execute on function app.assert_platform_demo_events() to service_role;

select app.register_release(
  '20260918150000',
  'demo events: anonymous screen views per site, cascaded with it, counted for the console',
  'app.assert_platform_demo_events()'::regprocedure
);
