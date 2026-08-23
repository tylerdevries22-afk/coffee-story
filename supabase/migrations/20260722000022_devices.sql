-- 0022: paired devices.
--
-- Three of the five surfaces are screens nobody signs into. A kiosk in the
-- lobby, a pickup display on the wall and a prep tablet on the bench all run
-- unattended for a whole shift, so they cannot ask a person to authenticate
-- each morning -- and handing them a staff password would put a
-- full-privilege credential on hardware a guest can reach.
--
-- A device therefore authenticates as itself, with a claim set that carries no
-- `role` at all. Every staff policy in 0007 tests app.jwt_role() against the
-- brand_role values, so a device token can never satisfy one no matter what
-- else it holds. What a device may do is stated here, per role, and nowhere
-- else: the app is not trusted to scope itself.

create type app.device_role as enum ('kiosk', 'pos', 'display', 'prep');

create table public.devices (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  location_id uuid not null references public.locations (id) on delete cascade,
  role app.device_role not null,
  label text not null default '',                  -- "Lobby kiosk 1"

  -- Pairing is a short-lived, single-use code an operator reads off the HQ
  -- console and types into the device once. It is cleared on redemption so a
  -- code can never be replayed, and the partial unique index lets many
  -- devices sit unpaired without colliding on NULL.
  pairing_code text,
  pairing_expires_at timestamptz,
  paired_at timestamptz,

  -- Revocation is a column rather than a delete: a stolen tablet's history
  -- stays attributable, and app.device_is_active() fails closed on it.
  revoked_at timestamptz,
  last_seen_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index devices_pairing_code_idx on public.devices (pairing_code)
  where pairing_code is not null;
create index devices_location_idx on public.devices (location_id, role);
create index devices_brand_idx on public.devices (brand_id);

create trigger devices_touch before update on public.devices
  for each row execute function app.touch_updated_at();

-- Claim readers, mirroring the app.jwt_* helpers in 0001. -----------------

create or replace function app.jwt_device_id() returns uuid
language sql stable as $$
  select nullif(app.jwt_claims() ->> 'device_id', '')::uuid
$$;

create or replace function app.jwt_device_role() returns text
language sql stable as $$
  select app.jwt_claims() ->> 'device_role'
$$;

create or replace function app.jwt_device_location() returns uuid
language sql stable as $$
  select nullif(app.jwt_claims() ->> 'device_location_id', '')::uuid
$$;

/**
 * A device token is only good while its row says so.
 *
 * Revoking in HQ has to take effect without waiting for a token to expire, so
 * every device policy goes through here rather than trusting the claim alone.
 * security definer because the caller is the device itself, which by design
 * cannot read the devices table.
 */
create or replace function app.device_is_active(wanted_role app.device_role) returns boolean
language sql stable security definer set search_path = public, app as $$
  select exists (
    select 1 from public.devices d
     where d.id = app.jwt_device_id()
       and d.role = wanted_role
       and d.revoked_at is null
       and d.paired_at is not null
       and d.brand_id = app.jwt_brand_id()
       and d.location_id = app.jwt_device_location()
  )
$$;

/** True for a device of any role at this brand and location. */
create or replace function app.is_device_at(target_brand uuid, target_location uuid) returns boolean
language sql stable as $$
  select app.jwt_device_id() is not null
     and app.jwt_brand_id() = target_brand
     and app.jwt_device_location() = target_location
$$;

-- RLS ---------------------------------------------------------------------

alter table public.devices enable row level security;

-- Operators manage their own devices; a device may read its own row so it can
-- show which station it is, and nothing else. It may never write one --
-- pairing and revocation run through the engine's service role.
create policy devices_select on public.devices for select
  using (app.is_brand_staff(brand_id) or id = app.jwt_device_id());
create policy devices_insert on public.devices for insert
  with check (app.is_brand_owner(brand_id) or app.at_location(brand_id, location_id));
create policy devices_update on public.devices for update
  using (app.is_brand_owner(brand_id) or app.at_location(brand_id, location_id))
  with check (app.is_brand_owner(brand_id) or app.at_location(brand_id, location_id));
create policy devices_delete on public.devices for delete
  using (app.is_brand_owner(brand_id));

grant select on public.devices to authenticated;
