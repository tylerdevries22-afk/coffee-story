-- Demo sites: what the demo factory builds for one prospect business.
--
-- A demo is a branded preview of the guest apps, built from a business's
-- Google listing and its own website and shown at /d/<token> for a fixed
-- window. It is not a tenant: it has no brand row, no location, no auth user,
-- no git folder and no cloud project of its own. One shared deployment renders
-- every demo from the pack stored here, which is what keeps a demo at cents
-- rather than at the cost of a provisioning run.
--
-- The link is a bearer capability -- anyone holding it can view the demo -- so
-- only the SHA-256 of the token is stored. A leaked dump or an over-broad
-- admin query must not be able to open a single demo.
--
-- Removal is one click by design, and permanent: the pack is wiped and the
-- business goes on a suppression list that the database itself enforces, so
-- "remove my business" also means "never build me again", whatever a future
-- batch runner forgets to check.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('demo-media', 'demo-media', false, 10485760,
        array['image/webp', 'image/png', 'image/jpeg'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- No storage.objects policies are added for demo-media. Only the service role
-- reads or writes it; a demo page reaches an image through the HQ server,
-- which checks the token and the expiry first.

create table public.platform_demo_sites (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique
    constraint platform_demo_sites_token_hash_is_sha256
    check (token_hash ~ '^[0-9a-f]{64}$'),
  google_place_id text
    check (google_place_id is null or google_place_id ~ '^[A-Za-z0-9_-]{6,255}$'),
  business_name text not null check (length(btrim(business_name)) between 1 and 160),
  website_host text check (
    website_host is null or (
      length(website_host) <= 253
      and website_host ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
    )
  ),
  industry_key text not null check (industry_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  country_code text check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  pack jsonb not null default '{}'::jsonb check (
    jsonb_typeof(pack) = 'object' and pg_column_size(pack) <= 524288
  ),
  state text not null default 'building'
    check (state in ('building', 'ready', 'removed', 'expired')),
  expires_at timestamptz not null default (now() + interval '14 days'),
  removed_at timestamptz,
  removal_reason text check (removal_reason in ('owner_request', 'operator')),
  open_count integer not null default 0 check (open_count >= 0),
  first_opened_at timestamptz,
  last_opened_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint platform_demo_sites_removed_when_recorded
    check ((state = 'removed') = (removed_at is not null)),
  constraint platform_demo_sites_removal_has_reason
    check ((removed_at is null) = (removal_reason is null)),
  constraint platform_demo_sites_expires_after_creation check (expires_at > created_at)
);

comment on table public.platform_demo_sites is
  'One prospect demo: a pack rendered by the shared demo deployment at '
  '/d/<token>. Never a tenant. token_hash is SHA-256 of the bearer link.';

-- One live demo per business: a batch is idempotent on the listing, and a
-- prospect is never pitched twice because a run was retried.
create unique index platform_demo_sites_one_live_per_place
  on public.platform_demo_sites (google_place_id)
  where google_place_id is not null and state in ('building', 'ready');

create index platform_demo_sites_expiry_idx
  on public.platform_demo_sites (expires_at)
  where state in ('building', 'ready');

-- Covers the foreign key, so deleting a staff user does not scan every demo.
create index platform_demo_sites_created_by_idx
  on public.platform_demo_sites (created_by);

create table public.platform_demo_suppressions (
  kind text not null check (kind in ('google_place', 'website_host')),
  value text not null,
  reason text not null check (reason in ('owner_request', 'operator')),
  created_at timestamptz not null default now(),
  primary key (kind, value),
  constraint platform_demo_suppressions_value_matches_kind check (
    (kind = 'google_place' and value ~ '^[A-Za-z0-9_-]{6,255}$')
    or (kind = 'website_host' and length(value) <= 253 and value ~ '^[a-z0-9.-]+$')
  )
);

comment on table public.platform_demo_suppressions is
  'Businesses that asked not to be demoed. Enforced on insert and update of '
  'platform_demo_sites, so no runner can build one of them again.';

create trigger platform_demo_sites_touch before update on public.platform_demo_sites
for each row execute function app.touch_updated_at();

create function app.refuse_suppressed_demo_site()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if exists (
    select 1 from public.platform_demo_suppressions suppression
    where (suppression.kind = 'google_place' and suppression.value = new.google_place_id)
       or (suppression.kind = 'website_host' and suppression.value = new.website_host)
  ) then
    raise exception 'this business asked not to be demoed'
      using errcode = '23514', constraint = 'platform_demo_sites_not_suppressed';
  end if;
  return new;
end $$;

create trigger platform_demo_sites_refuse_suppressed
before insert or update of google_place_id, website_host on public.platform_demo_sites
for each row execute function app.refuse_suppressed_demo_site();

alter table public.platform_demo_sites enable row level security;
alter table public.platform_demo_suppressions enable row level security;

create policy platform_demo_sites_platform_read on public.platform_demo_sites
for select to authenticated using (app.is_platform_admin());
create policy platform_demo_suppressions_platform_read on public.platform_demo_suppressions
for select to authenticated using (app.is_platform_admin());

revoke all on public.platform_demo_sites, public.platform_demo_suppressions
  from public, anon, authenticated;
grant select on public.platform_demo_sites, public.platform_demo_suppressions to authenticated;
grant all on public.platform_demo_sites, public.platform_demo_suppressions to service_role;

-- Opening a demo is the outreach loop's only signal that a prospect looked,
-- so the count is taken here, in one statement, rather than read and written
-- back by the server where two opens could land as one.
create function public.open_platform_demo_site(p_token_hash text)
returns table (id uuid, business_name text, industry_key text, expires_at timestamptz)
language sql security invoker set search_path = '' as $$
  update public.platform_demo_sites as site
     set open_count = site.open_count + 1,
         first_opened_at = coalesce(site.first_opened_at, now()),
         last_opened_at = now()
   where site.token_hash = p_token_hash
     and site.state = 'ready'
     and site.expires_at > now()
  returning site.id, site.business_name, site.industry_key, site.expires_at;
$$;

-- The pack, the name and the identifiers go in the same statement that marks
-- the row removed, and the identifiers move to the suppression list, so there
-- is no state in which a removed business is still stored as a demo.
create function public.remove_platform_demo_site(
  p_token_hash text,
  p_reason text default 'owner_request'
)
returns table (id uuid)
language sql security invoker set search_path = '' as $$
  with target as (
    select site.id, site.google_place_id, site.website_host
      from public.platform_demo_sites as site
     where site.token_hash = p_token_hash and site.state <> 'removed'
     for update
  ),
  removed as (
    update public.platform_demo_sites as site
       set state = 'removed', removed_at = now(), removal_reason = p_reason,
           pack = '{}'::jsonb, business_name = 'Removed',
           google_place_id = null, website_host = null
      from target
     where site.id = target.id
    returning site.id, target.google_place_id, target.website_host
  ),
  suppressed as (
    insert into public.platform_demo_suppressions (kind, value, reason)
    select 'google_place', removed.google_place_id, p_reason
      from removed where removed.google_place_id is not null
    union all
    select 'website_host', removed.website_host, p_reason
      from removed where removed.website_host is not null
    on conflict (kind, value) do nothing
    returning 1
  )
  select removed.id from removed;
$$;

-- Expiry keeps the name, so the link can still say whose demo it was and
-- offer a rebuild, and drops everything that was scraped.
create function public.expire_platform_demo_sites(p_limit integer default 200)
returns table (id uuid)
language sql security invoker set search_path = '' as $$
  update public.platform_demo_sites as site
     set state = 'expired', pack = '{}'::jsonb
   where site.id in (
     select due.id from public.platform_demo_sites as due
      where due.state in ('building', 'ready') and due.expires_at <= now()
      order by due.expires_at
      limit greatest(1, least(coalesce(p_limit, 200), 1000))
      for update skip locked
   )
  returning site.id;
$$;

revoke all on function public.open_platform_demo_site(text) from public, anon, authenticated;
revoke all on function public.remove_platform_demo_site(text, text) from public, anon, authenticated;
revoke all on function public.expire_platform_demo_sites(integer) from public, anon, authenticated;
revoke all on function app.refuse_suppressed_demo_site() from public, anon, authenticated;
grant execute on function public.open_platform_demo_site(text) to service_role;
grant execute on function public.remove_platform_demo_site(text, text) to service_role;
grant execute on function public.expire_platform_demo_sites(integer) to service_role;

create function app.assert_platform_demo_sites()
returns void language plpgsql stable security invoker set search_path = '' as $$
begin
  if exists (
    select 1 from pg_catalog.pg_class relation
    where relation.oid in (
      'public.platform_demo_sites'::regclass, 'public.platform_demo_suppressions'::regclass
    ) and not relation.relrowsecurity
  ) then
    raise exception 'demo sites lost row level security';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.platform_demo_sites'::regclass
      and constraint_row.conname = 'platform_demo_sites_token_hash_is_sha256'
  ) then
    raise exception 'demo tokens may now be stored in the clear';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_indexes index_row
    where index_row.schemaname = 'public' and index_row.tablename = 'platform_demo_sites'
      and index_row.indexname = 'platform_demo_sites_one_live_per_place'
  ) then
    raise exception 'one business may now hold two live demos';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_trigger trigger_row
    where trigger_row.tgrelid = 'public.platform_demo_sites'::regclass
      and trigger_row.tgname = 'platform_demo_sites_refuse_suppressed'
      and trigger_row.tgenabled <> 'D'
  ) then
    raise exception 'a business that asked to be removed could be demoed again';
  end if;
  if pg_catalog.has_table_privilege('anon', 'public.platform_demo_sites', 'select')
    or pg_catalog.has_function_privilege('anon', 'public.open_platform_demo_site(text)', 'execute')
    or pg_catalog.has_function_privilege('authenticated', 'public.remove_platform_demo_site(text, text)', 'execute')
  then
    raise exception 'demo sites are reachable by a client role';
  end if;
end $$;

revoke all on function app.assert_platform_demo_sites() from public, anon, authenticated;
grant execute on function app.assert_platform_demo_sites() to service_role;

select app.register_release(
  '20260918120000',
  'demo sites: token-hashed, expiring, one live per business, removal suppressed for good',
  'app.assert_platform_demo_sites()'::regprocedure
);
