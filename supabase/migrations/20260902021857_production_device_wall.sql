-- Production Device Wall. Inventory and audit data live here; tenant JSON
-- contains policy only. Media never enters Postgres.

create unique index if not exists locations_id_brand_device_wall_idx
  on public.locations (id, brand_id);
create unique index if not exists devices_id_brand_location_device_wall_idx
  on public.devices (id, brand_id, location_id);

create table public.device_installations (
  id uuid primary key,
  brand_id uuid not null references public.brands (id) on delete cascade,
  location_id uuid not null,
  paired_device_id uuid,
  installed_by uuid references auth.users (id) on delete set null,
  label text not null check (char_length(label) between 1 and 80),
  form_factor text not null check (form_factor in ('phone', 'tablet', 'tv')),
  app_target text not null check (app_target in ('operator', 'pickup_queue', 'kiosk_pos')),
  platform text not null check (platform in ('ios', 'android', 'web')),
  app_version text not null check (char_length(app_version) between 1 and 40),
  runtime_version text not null check (char_length(runtime_version) between 1 and 60),
  capabilities text[] not null default '{}' check (
    capabilities <@ array['heartbeat', 'diagnostics', 'screen_capture', 'webrtc', 'turn']::text[]
  ),
  identity_fingerprint text not null check (identity_fingerprint ~ '^[a-f0-9]{64}$'),
  public_key_jwk jsonb check (
    public_key_jwk is null or (
      jsonb_typeof(public_key_jwk) = 'object'
      and octet_length(public_key_jwk::text) <= 8192
    )
  ),
  last_seen_at timestamptz,
  archived_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (location_id, brand_id)
    references public.locations (id, brand_id) on delete cascade,
  foreign key (paired_device_id, brand_id, location_id)
    references public.devices (id, brand_id, location_id)
    on delete set null (paired_device_id),
  check (paired_device_id is not null or installed_by is not null),
  unique (id, brand_id, location_id),
  unique (brand_id, identity_fingerprint)
);

create unique index device_installations_paired_device_idx
  on public.device_installations (paired_device_id) where paired_device_id is not null;
create index device_installations_wall_idx
  on public.device_installations (brand_id, location_id, archived_at, last_seen_at desc);
create trigger device_installations_touch before update on public.device_installations
  for each row execute function app.touch_updated_at();

create table public.device_wall_layouts (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  location_id uuid,
  layout jsonb not null default '[]'::jsonb check (
    jsonb_typeof(layout) = 'array' and octet_length(layout::text) <= 65536
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (location_id, brand_id)
    references public.locations (id, brand_id) on delete cascade,
  unique nulls not distinct (brand_id, user_id, location_id)
);
create trigger device_wall_layouts_touch before update on public.device_wall_layouts
  for each row execute function app.touch_updated_at();

create table public.device_diagnostic_runs (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null,
  brand_id uuid not null,
  location_id uuid not null,
  requested_by uuid not null references auth.users (id) on delete restrict,
  results jsonb not null default '[]'::jsonb check (
    jsonb_typeof(results) = 'array' and octet_length(results::text) <= 32768
  ),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '365 days',
  foreign key (installation_id, brand_id, location_id)
    references public.device_installations (id, brand_id, location_id) on delete cascade
);
create index device_diagnostic_runs_installation_idx
  on public.device_diagnostic_runs (installation_id, created_at desc);

create table public.device_wall_enrollment_codes (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null,
  paired_device_id uuid not null references public.devices (id) on delete cascade,
  brand_id uuid not null,
  location_id uuid not null,
  code_hash text not null check (char_length(code_hash) between 32 and 256),
  created_by uuid not null references auth.users (id) on delete restrict,
  expires_at timestamptz not null,
  redeemed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (installation_id, brand_id, location_id)
    references public.device_installations (id, brand_id, location_id) on delete cascade,
  check (expires_at <= created_at + interval '10 minutes'),
  check (redeemed_at is null or redeemed_at <= expires_at),
  unique (code_hash)
);
create unique index device_wall_enrollment_active_idx
  on public.device_wall_enrollment_codes (installation_id)
  where redeemed_at is null and revoked_at is null;

create or replace function app.redeem_device_wall_enrollment()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.paired_at is null and new.paired_at is not null then
    update public.device_wall_enrollment_codes
    set redeemed_at = new.paired_at
    where paired_device_id = new.id
      and redeemed_at is null and revoked_at is null
      and expires_at >= new.paired_at;
  end if;
  return new;
end $$;
revoke all on function app.redeem_device_wall_enrollment()
  from public, anon, authenticated;
create trigger device_wall_enrollment_redeem
  after update of paired_at on public.devices
  for each row execute function app.redeem_device_wall_enrollment();

create table public.device_stream_sessions (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null,
  brand_id uuid not null,
  location_id uuid not null,
  viewer_id uuid not null references auth.users (id) on delete restrict,
  state text not null default 'requested' check (
    state in ('requested', 'consent_required', 'connecting', 'live', 'ended')
  ),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ended_at timestamptz,
  foreign key (installation_id, brand_id, location_id)
    references public.device_installations (id, brand_id, location_id) on delete cascade,
  check (expires_at <= created_at + interval '15 minutes')
);
create unique index device_stream_sessions_one_viewer_idx
  on public.device_stream_sessions (installation_id) where ended_at is null;
create index device_stream_sessions_viewer_idx
  on public.device_stream_sessions (brand_id, viewer_id, ended_at, expires_at);

create table public.device_stream_audit_events (
  id bigint generated always as identity primary key,
  session_id uuid references public.device_stream_sessions (id) on delete set null,
  installation_id uuid not null,
  brand_id uuid not null,
  location_id uuid not null,
  viewer_id uuid not null references auth.users (id) on delete restrict,
  event text not null check (
    event in ('requested', 'consent_required', 'connected', 'ended', 'denied', 'failed')
  ),
  reason_code text check (reason_code ~ '^[a-z0-9_]{1,40}$'),
  created_at timestamptz not null default now(),
  foreign key (installation_id, brand_id, location_id)
    references public.device_installations (id, brand_id, location_id) on delete cascade
);
create index device_stream_audit_events_installation_idx
  on public.device_stream_audit_events (installation_id, created_at desc);

alter table public.device_installations enable row level security;
alter table public.device_wall_layouts enable row level security;
alter table public.device_diagnostic_runs enable row level security;
alter table public.device_wall_enrollment_codes enable row level security;
alter table public.device_stream_sessions enable row level security;
alter table public.device_stream_audit_events enable row level security;

create policy device_installations_status_read on public.device_installations for select using (
  app.is_brand_owner(brand_id)
  or (app.jwt_role() = 'location_manager' and app.at_location(brand_id, location_id))
  or installed_by = (select auth.uid())
  or paired_device_id = app.jwt_device_id()
);
create policy device_wall_layouts_own on public.device_wall_layouts for all using (
  user_id = (select auth.uid()) and app.is_brand_staff(brand_id)
  and (location_id is null or app.at_location(brand_id, location_id))
) with check (
  user_id = (select auth.uid()) and app.is_brand_staff(brand_id)
  and (location_id is null or app.at_location(brand_id, location_id))
);
create policy device_diagnostic_runs_owner_read on public.device_diagnostic_runs for select
  using (app.is_brand_owner(brand_id));
create policy device_stream_audit_events_owner_read on public.device_stream_audit_events for select
  using (app.is_brand_owner(brand_id));

revoke all on public.device_installations, public.device_wall_layouts,
  public.device_diagnostic_runs, public.device_wall_enrollment_codes,
  public.device_stream_sessions, public.device_stream_audit_events
  from anon, authenticated;
grant select (id, brand_id, location_id, installed_by, label, form_factor,
  app_target, platform, app_version, runtime_version, capabilities,
  last_seen_at, archived_at, revoked_at, created_at, updated_at)
  on public.device_installations to authenticated;
grant select, insert, update, delete on public.device_wall_layouts to authenticated;
grant select on public.device_diagnostic_runs, public.device_stream_audit_events to authenticated;

-- Private channels are per installation. Owners can test every device; a
-- staff member or paired app can participate only for its own installation.
create policy device_wall_realtime_read on realtime.messages for select to authenticated using (
  exists (
    select 1 from public.device_installations installation
    where realtime.topic() = 'device-wall:' || installation.id::text
      and installation.archived_at is null and installation.revoked_at is null
      and (
        app.is_brand_owner(installation.brand_id)
        or installation.installed_by = (select auth.uid())
        or installation.paired_device_id = app.jwt_device_id()
      )
  )
);
create policy device_wall_realtime_write on realtime.messages for insert to authenticated with check (
  exists (
    select 1 from public.device_installations installation
    where realtime.topic() = 'device-wall:' || installation.id::text
      and installation.archived_at is null and installation.revoked_at is null
      and (
        app.is_brand_owner(installation.brand_id)
        or installation.installed_by = (select auth.uid())
        or installation.paired_device_id = app.jwt_device_id()
      )
  )
);

create or replace function app.archive_stale_device_installations(p_now timestamptz default now())
returns integer language plpgsql security definer set search_path = '' as $$
declare affected integer;
begin
  update public.device_installations
  set archived_at = p_now
  where archived_at is null and revoked_at is null
    and coalesce(last_seen_at, created_at) < p_now - interval '30 days';
  get diagnostics affected = row_count;
  delete from public.device_diagnostic_runs where expires_at < p_now;
  delete from public.device_stream_audit_events where created_at < p_now - interval '365 days';
  return affected;
end $$;
revoke all on function app.archive_stale_device_installations(timestamptz)
  from public, anon, authenticated;
grant execute on function app.archive_stale_device_installations(timestamptz) to service_role;

create or replace function app.create_device_stream_session(
  p_installation_id uuid, p_brand_id uuid, p_location_id uuid,
  p_viewer_id uuid, p_max_streams integer
) returns public.device_stream_sessions
language plpgsql security definer set search_path = '' as $$
declare created public.device_stream_sessions;
begin
  if p_max_streams < 1 or p_max_streams > 8 then
    raise exception using errcode = '22023', message = 'invalid_stream_limit';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_viewer_id::text));
  update public.device_stream_sessions set state = 'ended', ended_at = now()
  where ended_at is null and expires_at <= now();
  if not exists (
    select 1 from public.device_installations installation
    where installation.id = p_installation_id and installation.brand_id = p_brand_id
      and installation.location_id = p_location_id
      and installation.archived_at is null and installation.revoked_at is null
  ) then raise exception using errcode = 'P0002', message = 'installation_unavailable'; end if;
  if (select count(*) from public.device_stream_sessions
      where brand_id = p_brand_id and viewer_id = p_viewer_id
        and ended_at is null and expires_at > now()) >= p_max_streams then
    raise exception using errcode = '54000', message = 'stream_limit_reached';
  end if;
  insert into public.device_stream_sessions (
    installation_id, brand_id, location_id, viewer_id, expires_at
  ) values (p_installation_id, p_brand_id, p_location_id, p_viewer_id, now() + interval '5 minutes')
  returning * into created;
  insert into public.device_stream_audit_events (
    session_id, installation_id, brand_id, location_id, viewer_id, event
  ) values (created.id, p_installation_id, p_brand_id, p_location_id, p_viewer_id, 'requested');
  return created;
exception when unique_violation then
  raise exception using errcode = '55000', message = 'device_already_has_viewer';
end $$;
revoke all on function app.create_device_stream_session(uuid, uuid, uuid, uuid, integer)
  from public, anon, authenticated;
grant execute on function app.create_device_stream_session(uuid, uuid, uuid, uuid, integer)
  to service_role;

create or replace function app.record_device_heartbeat(
  p_installation_id uuid, p_brand_id uuid, p_location_id uuid,
  p_paired_device_id uuid, p_user_id uuid
) returns timestamptz language plpgsql security definer set search_path = '' as $$
declare seen_at timestamptz := now();
begin
  update public.device_installations set last_seen_at = seen_at
  where id = p_installation_id and brand_id = p_brand_id and location_id = p_location_id
    and archived_at is null and revoked_at is null
    and ((p_paired_device_id is not null and paired_device_id = p_paired_device_id)
      or (p_user_id is not null and installed_by = p_user_id));
  if not found then raise exception using errcode = 'P0002', message = 'installation_unavailable'; end if;
  return seen_at;
end $$;
revoke all on function app.record_device_heartbeat(uuid, uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function app.record_device_heartbeat(uuid, uuid, uuid, uuid, uuid)
  to service_role;

create or replace function app.revoke_device_installation(
  p_installation_id uuid, p_brand_id uuid
) returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.device_installations
    where id = p_installation_id and brand_id = p_brand_id and revoked_at is null
  ) then raise exception using errcode = 'P0002', message = 'installation_unavailable'; end if;
  insert into public.device_stream_audit_events (
    session_id, installation_id, brand_id, location_id, viewer_id, event, reason_code
  ) select id, installation_id, brand_id, location_id, viewer_id, 'ended', 'installation_revoked'
    from public.device_stream_sessions
    where installation_id = p_installation_id and brand_id = p_brand_id and ended_at is null;
  update public.device_stream_sessions set state = 'ended', ended_at = now()
    where installation_id = p_installation_id and brand_id = p_brand_id and ended_at is null;
  update public.device_installations set revoked_at = now()
    where id = p_installation_id and brand_id = p_brand_id;
  return true;
end $$;
revoke all on function app.revoke_device_installation(uuid, uuid)
  from public, anon, authenticated;
grant execute on function app.revoke_device_installation(uuid, uuid) to service_role;

alter function public.platform_release_readiness()
  rename to platform_release_readiness_20260901060421;
alter function public.platform_release_readiness_20260901060421() set schema app;
revoke all on function app.platform_release_readiness_20260901060421()
  from public, anon, authenticated;
grant execute on function app.platform_release_readiness_20260901060421() to service_role;

create or replace function public.platform_release_readiness()
returns text language plpgsql stable security invoker set search_path = '' as $$
begin
  if app.platform_release_readiness_20260901060421() <> '20260901060421' then
    raise exception 'device wall readiness prerequisite is incomplete';
  end if;
  if pg_catalog.to_regclass('public.device_installations') is null
     or pg_catalog.to_regclass('public.device_stream_audit_events') is null then
    raise exception 'device wall tables are missing';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_class
    where oid = 'public.device_installations'::regclass and relrowsecurity
  ) then raise exception 'device installations are not protected by RLS'; end if;
  if not exists (
    select 1 from pg_catalog.pg_policies where schemaname = 'realtime'
      and tablename = 'messages' and policyname = 'device_wall_realtime_write'
  ) then raise exception 'private device signaling policy is missing'; end if;
  return '20260902021857';
end $$;
revoke all on function public.platform_release_readiness() from public, anon, authenticated;
grant execute on function public.platform_release_readiness() to service_role;
