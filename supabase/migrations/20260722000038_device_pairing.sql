-- 0038: make a device token something the platform can actually issue, and
-- close the three holes 0022 and 0023 left behind it.
--
-- 0022 built `devices`, the `app.jwt_device_*` readers and `device_is_active`,
-- and `docs/FIVE-SURFACES.md` calls that table the keystone of the three
-- surfaces nobody signs into. Nothing ever minted a token those readers could
-- see -- `app.custom_access_token` (0009) is a GoTrue hook and emits only
-- brand_id / role / location_ids / brand_name -- so `app.device_is_active()`
-- was false for every principal the platform could issue and the kiosk,
-- display and prep policies could never pass. The minter now lives in
-- packages/engine/src/devices.ts; this migration is the schema it needs, plus
-- the defects an audit found while reading the rest of the table.

-- ---------------------------------------------------------------------------
-- 1. A pairing code stops being a secret every barista can read.
--
-- `devices_select` is `using (app.is_brand_staff(brand_id) or id =
-- app.jwt_device_id())`, and `app.is_brand_staff` (0001) is brand-wide with no
-- location term and includes `role = 'staff'`. So the plaintext column meant
-- any staff account could run `select pairing_code from public.devices` for ANY
-- location of the brand and pair their own hardware as a kiosk at a store they
-- have never been to. Hashed, the column is worth nothing to a reader: the code
-- exists only in the HTTP response that minted it.

alter table public.devices add column pairing_code_hash text;

drop index if exists devices_pairing_code_idx;
create unique index devices_pairing_code_hash_idx
  on public.devices (pairing_code_hash)
  where pairing_code_hash is not null;

alter table public.devices drop column pairing_code;

comment on column public.devices.pairing_code_hash is
  'HMAC of the pairing code. The code itself is returned once, when it is minted, '
  'and is never readable again -- devices_select is brand-wide and includes staff.';

-- ---------------------------------------------------------------------------
-- 2. Revocation invalidates an outstanding token, not just the next RLS query.
--
-- `app.device_is_active` re-reads the row, so RLS bites the moment a device is
-- revoked. But `/api/orders` runs as the service role with RLS bypassed, and
-- without a version to compare, a revoked kiosk would keep ringing sales for
-- the remaining life of its token -- up to twelve hours. The version is stamped
-- into the claim and checked on every request.

alter table public.devices
  add column token_version integer not null default 1;

comment on column public.devices.token_version is
  'Bumped on revoke and on re-pair. Stamped into the device JWT and compared on '
  'every API request, so revocation bites on the service-role path too.';

-- ---------------------------------------------------------------------------
-- 3. A device lifecycle stops being client-writable.
--
-- 0022 says in a comment that a device "may never write one -- pairing and
-- revocation run through the engine's service role". Its own policies say
-- otherwise: 0014 does `alter default privileges in schema public grant all on
-- tables to authenticated`, and `devices` was created at 0022, AFTER that. With
-- `devices_update` gating only on `is_brand_owner`/`at_location`, a
-- location_manager could clear `revoked_at` on a stolen tablet, back-date
-- `paired_at`, or plant a `pairing_code_hash` whose preimage they know.
--
-- Same shape as `app.protect_fee_terms` (0031 section 5): the service role
-- carries no `jwt_role`, so the engine is unaffected and only a signed-in
-- person is constrained. `label` stays editable, because naming the tablet in
-- the corner is the one thing a manager legitimately does here.

create or replace function app.protect_device_lifecycle() returns trigger
language plpgsql as $$
begin
  if app.jwt_role() is not null then
    if tg_op = 'INSERT' then
      raise exception 'devices are created by the pairing service, not by a client';
    end if;
    if new.pairing_code_hash is distinct from old.pairing_code_hash
       or new.pairing_expires_at is distinct from old.pairing_expires_at
       or new.paired_at is distinct from old.paired_at
       or new.revoked_at is distinct from old.revoked_at
       or new.token_version is distinct from old.token_version
       or new.role is distinct from old.role
       or new.brand_id is distinct from old.brand_id
       or new.location_id is distinct from old.location_id then
      raise exception 'a device lifecycle is managed by the pairing service; only its label may be edited here';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists devices_protect_lifecycle on public.devices;
create trigger devices_protect_lifecycle
  before insert or update on public.devices
  for each row execute function app.protect_device_lifecycle();

-- ---------------------------------------------------------------------------
-- 4. A kiosk reads back its own order, not the last hour of the shop's.
--
-- 0023's comment says a kiosk "may read back only the order it just placed,
-- which is how the receipt screen shows a ticket number". The policy it wrote
-- says something much wider: every order at that location in the past hour,
-- including `customer_id`, `note` and the whole `totals` cart snapshot, to
-- anyone who can reach a lobby tablet's token. Recording which device placed an
-- order makes the narrow version expressible -- and answers "which till rang
-- this" for the analytics that will want it.

alter table public.orders
  add column device_id uuid references public.devices (id) on delete set null;

create index orders_device_idx on public.orders (device_id, created_at desc)
  where device_id is not null;

drop policy if exists orders_kiosk_select on public.orders;
create policy orders_kiosk_select on public.orders for select
  using (
    (app.device_is_active('kiosk') or app.device_is_active('pos'))
    and location_id = app.jwt_device_location()
    and device_id = app.jwt_device_id()
    -- Still time-boxed: a receipt is read seconds after it is printed, and a
    -- till that has been running all day has no reason to re-read this morning.
    and created_at > now() - interval '1 hour'
  );

comment on column public.orders.device_id is
  'Which paired device took the order. Null for app and web. Narrows '
  'orders_kiosk_select to the device own orders rather than the location hour.';
