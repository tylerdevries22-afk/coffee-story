-- Stop a logged-out caller reading the platform's roster out of the catalog
-- and the realtime signal tables.
--
-- 0014 set `alter default privileges in schema public grant select on tables
-- to anon`, so every table added since has carried an anon SELECT unless a
-- migration took it back. Four of them then wrote a row policy that admits
-- anyone:
--
--   catalog_publications  `using (true)`, no role clause
--   catalog_releases      `using (status = 'published' or is_brand_owner(...))`
--   brand_config_signals  `using (true)` to anon, authenticated
--   location_setting_signals `using (true)`, no role clause
--
-- Grant plus permissive policy means one unfiltered `select` with the
-- publishable key -- which ships inside every tenant's app bundle -- returns
-- every brand's row. `catalog_releases` is the worst of the four: `manifest`
-- is the whole published catalogue, so a single request hands one tenant
-- every competitor's offerings, option groups and prices, plus `created_by`,
-- a brand_users id and therefore an account-enumeration oracle. The other
-- three leak the identifiers and the cadence: which brands exist, which
-- locations belong to which brand, and how often each one changes its
-- configuration. On a platform whose tenants are each other's competitors
-- that is a commercial disclosure before it is a security one.
--
-- 20260903005237 narrowed the same shape on `brand_storefront` by moving the
-- filter into the function and dropping the unfiltered surface. That works
-- where the client makes a request. It does NOT work here, because three of
-- these four tables are in `supabase_realtime` and a running customer app,
-- kiosk and pickup display learn that configuration changed by subscribing to
-- them:
--
--   packages/data/src/brand.ts      brand_config_signals, brand_id=eq.<id>
--   packages/data/src/location.ts   location_setting_signals, location_id=eq.<id>
--   packages/data/src/menu.ts       catalog_publications, brand_id=eq.<id>
--   packages/data/src/catalog.ts    catalog_publications, brand_id=eq.<id>
--
-- Those clients hold the publishable key and no session: apps/kiosk's read
-- client is built from EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY with no storage
-- adapter, and apps/customer subscribes before anyone signs in. Realtime
-- evaluates RLS per row under the subscriber's role, so revoking anon's read
-- makes every deployed client go quiet -- an 86'd item that never leaves the
-- screen, a paused shop that keeps taking orders -- and it does so silently.
-- That is a worse outcome than the leak.
--
-- What Realtime actually needs from anon is narrower than a table grant. It
-- checks visibility with `select exists(select 1 from <table> where <primary
-- key> = ...)` under the subscriber's role, it refuses a subscription whose
-- filter names a column the role cannot read, and it drops from the payload
-- every column the role has no privilege on. So the primary key -- the column
-- the client already filters on, and already knew before it subscribed -- is
-- the whole requirement. Everything else is disclosure with no subscriber.
--
-- Hence column grants rather than a revoke, which is how 0040 kept the
-- storefront's `locations` read working while removing the negotiated fee
-- terms from it. Anon keeps exactly one column per signal table and loses the
-- revision counter and the changed_at timestamp, which is the operating
-- cadence; `location_setting_signals` also loses `brand_id`, which is the
-- location-to-brand map. The clients ignore the payload entirely -- all four
-- subscriptions call a refetch and read nothing from the message -- so this
-- is invisible to them.
--
-- `catalog_releases` is not in the publication and has no subscriber, so it
-- takes the storefront treatment instead: the anon grant goes entirely and
-- the guest read moves behind a definer keyed on the one brand it names.
--
-- Not closed here, stated instead: anon can still count the rows in the three
-- signal tables and read their opaque keys, because the subscription filter
-- requires that column and old bundles are already deployed against it. That
-- residual is bounded by `public.locations`, whose `locations_select` is
-- `using (true)` by the deliberate decision recorded in 0040 -- a brand's
-- name and address are storefront data -- and which therefore already
-- publishes the same brand and location identifiers under names. Narrowing
-- these keys is only worth doing after that read moves behind a lookup, which
-- is a change to twenty-nine call sites and does not belong in this migration.
--
-- Estimated cost: catalog-only. Two function definitions and eight grant
-- statements. No table is read, rewritten or locked.

-- 1. catalog_releases -------------------------------------------------------
--
-- The guest menu is the only anonymous reader (packages/data/src/catalog.ts,
-- reached through fetchMenuTree). It wants one release: the one currently
-- published for the brand it is rendering. The join to catalog_publications
-- lives in the definer so the caller cannot ask for a different one, and
-- naming no brand returns nothing rather than everything.
revoke select on public.catalog_releases from anon;

create or replace function app.published_catalog_rows(p_brand_id uuid)
returns table (
  id uuid,
  brand_id uuid,
  version integer,
  status text,
  manifest jsonb,
  created_at timestamptz,
  published_at timestamptz
)
language sql stable security definer
set search_path = ''
as $$
  select release.id, release.brand_id, release.version, release.status,
         release.manifest, release.created_at, release.published_at
    from public.catalog_publications publication
    join public.catalog_releases release
      on release.id = publication.release_id
     and release.brand_id = publication.brand_id
   where p_brand_id is not null
     and publication.brand_id = p_brand_id
     and release.status = 'published'
   limit 1
$$;
revoke execute on function app.published_catalog_rows(uuid) from public;
grant execute on function app.published_catalog_rows(uuid)
  to anon, authenticated, service_role;

-- Security invoker: the narrowing is in the definer it delegates to, and this
-- wrapper adds no privilege of its own. `created_by` is absent from the return
-- list on purpose -- it is a brand_users id, and a published catalogue is not
-- a place to learn who works for a competitor.
create or replace function public.published_catalog_lookup(
  p_brand_id uuid default null
)
returns table (
  id uuid,
  brand_id uuid,
  version integer,
  status text,
  manifest jsonb,
  created_at timestamptz,
  published_at timestamptz
)
language sql stable security invoker
set search_path = ''
as $$
  select * from app.published_catalog_rows(p_brand_id)
$$;
revoke execute on function public.published_catalog_lookup(uuid) from public;
grant execute on function public.published_catalog_lookup(uuid)
  to anon, authenticated, service_role;

comment on function public.published_catalog_lookup(uuid) is
  'The anonymous catalogue read. Returns at most the one published release of '
  'the brand named; naming no brand returns nothing. Replaces the anon SELECT '
  'on catalog_releases, which returned every brand''s published manifest.';

-- 2. catalog_publications ---------------------------------------------------
--
-- Stays readable, one column wide. `brand_id` is the primary key and the
-- column subscribeToMenu filters on, so Realtime needs it; release_id,
-- catalog_id, version and published_at are the publish history and have no
-- anonymous subscriber. `authenticated` is untouched: apps/hq reads `version`
-- through a staff session.
revoke select on public.catalog_publications from anon;
grant select (brand_id) on public.catalog_publications to anon;

-- 3. brand_config_signals ---------------------------------------------------
--
-- subscribeToBrandConfig (apps/kiosk) filters on brand_id and then refetches;
-- it never reads the message body. `revision` and `changed_at` therefore reach
-- no reader except one enumerating how often each tenant reconfigures.
revoke select on public.brand_config_signals from anon;
grant select (brand_id) on public.brand_config_signals to anon;

-- 4. location_setting_signals -----------------------------------------------
--
-- subscribeToLocationSettings (apps/kiosk, apps/customer, apps/operator)
-- filters on location_id. `brand_id` is the column worth removing: without it
-- the table is a list of opaque location keys rather than a map from every
-- location on the platform to the brand that owns it.
revoke select on public.location_setting_signals from anon;
grant select (location_id) on public.location_setting_signals to anon;

-- Deliberately unchanged, recorded so the next audit does not re-open them:
--
--   public.board_tickets   granted to anon since 0033, and closed by its own
--                          gate: security_invoker view over
--                          app.can_read_board(), which needs a display device
--                          claim, brand ownership or a location assignment.
--                          A caller with none of those gets no rows.
--   public.kiosk_receipts  dropped by 0042. The grant in 0034 refers to a
--                          view that no longer exists.

-- Readiness assertion. Catalog facts on both sides: what anon must not be able
-- to read, and what it must still be able to read. A later migration that runs
-- a bare `grant select on public.brand_config_signals to anon` fails the
-- release, and so does one that revokes the last column and takes every
-- deployed kiosk off the air.
create or replace function app.assert_anon_reads_are_scoped()
returns void language plpgsql stable security invoker set search_path = '' as $$
declare
  scoped record;
begin
  if exists (
    select 1 from pg_catalog.pg_attribute att
     where att.attrelid = 'public.catalog_releases'::regclass
       and att.attnum > 0 and not att.attisdropped
       and has_column_privilege('anon', att.attrelid, att.attnum, 'SELECT')
  ) then
    raise exception 'anon can read public.catalog_releases again';
  end if;

  for scoped in
    select *
      from (values
        ('catalog_publications'::text, 'brand_id'::text),
        ('brand_config_signals'::text, 'brand_id'::text),
        ('location_setting_signals'::text, 'location_id'::text)
      ) as pinned (relation, keeps)
  loop
    if not has_column_privilege(
      'anon', 'public.' || scoped.relation, scoped.keeps, 'SELECT'
    ) then
      raise exception
        'anon lost %.% -- realtime filters on it, so every deployed client goes quiet',
        scoped.relation, scoped.keeps;
    end if;
    if exists (
      select 1 from pg_catalog.pg_attribute att
       where att.attrelid = ('public.' || scoped.relation)::regclass
         and att.attnum > 0 and not att.attisdropped
         and att.attname <> scoped.keeps
         and has_column_privilege('anon', att.attrelid, att.attnum, 'SELECT')
    ) then
      raise exception 'anon can read more than % on %', scoped.keeps, scoped.relation;
    end if;
    if not exists (
      select 1 from pg_catalog.pg_publication_tables pub
       where pub.pubname = 'supabase_realtime'
         and pub.schemaname = 'public'
         and pub.tablename = scoped.relation
    ) then
      raise exception '% left the realtime publication', scoped.relation;
    end if;
  end loop;

  if to_regprocedure('public.published_catalog_lookup(uuid)') is null then
    raise exception 'the published catalog lookup entry point is missing';
  end if;
  if not has_function_privilege(
    'anon', 'public.published_catalog_lookup(uuid)'::regprocedure, 'EXECUTE'
  ) then
    raise exception 'anon cannot reach the published catalog lookup; a guest menu would be blank';
  end if;
end $$;
revoke all on function app.assert_anon_reads_are_scoped()
  from public, anon, authenticated;
grant execute on function app.assert_anon_reads_are_scoped() to service_role;

select app.register_release(
  '20260903230000',
  'scope the anonymous catalog and signal reads to the row a client already names',
  'app.assert_anon_reads_are_scoped()'::regprocedure
);
