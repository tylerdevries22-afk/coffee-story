-- A screen nobody signs into must be able to re-authenticate itself.
--
-- The production pickup display runs on a static twelve-hour device JWT baked
-- into DISPLAY_DEVICE_TOKEN. Two problems follow from that, and neither is
-- fixable in the app:
--
--   The token outlives its usefulness. /api/devices/refresh needs a currently
--   valid token to mint the next one, so once the twelve hours lapse the only
--   way back is a human re-deploying a new environment variable. An unattended
--   screen in a shop cannot do that, and the board goes dark mid-service.
--
--   Revocation is a deploy. token_version already stops an outstanding token on
--   the service-role path, but the replacement still has to be minted and
--   pasted by hand, so nobody rotates and the same secret sits in the
--   environment indefinitely.
--
-- The fix is the shape pairing already uses: a long-lived secret held only as an
-- HMAC, exchanged for a short-lived access token. The screen keeps the secret,
-- refreshes its own token ahead of expiry, and an operator can revoke it by
-- clearing one column.
--
-- Deliberately NOT rotated on every exchange. Single-use rotation is stronger
-- against replay, but an unattended screen that receives a new secret and then
-- loses the response bricks itself until someone drives to the shop. Rotation
-- is instead explicit, with a bounded overlap so the outgoing secret keeps
-- working until the screen has demonstrably taken the new one.

alter table public.devices
  add column refresh_secret_hash text,
  add column refresh_secret_issued_at timestamptz,
  add column refresh_secret_previous_hash text,
  add column refresh_secret_previous_expires_at timestamptz,
  add column refresh_secret_last_used_at timestamptz;

-- Same partial-unique shape as pairing_code_hash: many devices may hold no
-- secret without colliding on NULL, and a hash can only ever match one row.
create unique index devices_refresh_secret_hash_idx
  on public.devices (refresh_secret_hash)
  where refresh_secret_hash is not null;
create unique index devices_refresh_secret_previous_hash_idx
  on public.devices (refresh_secret_previous_hash)
  where refresh_secret_previous_hash is not null;

comment on column public.devices.refresh_secret_hash is
  'HMAC of the device refresh secret. The secret is returned once, when it is '
  'minted, and is never readable again -- devices_select is brand-wide and '
  'includes staff, exactly as for pairing_code_hash.';
comment on column public.devices.refresh_secret_previous_hash is
  'The outgoing secret during a rotation, honoured until '
  'refresh_secret_previous_expires_at so a screen that has not yet picked up '
  'the new secret keeps working.';
comment on column public.devices.refresh_secret_last_used_at is
  'When the secret was last exchanged for a token. An operator reads this to '
  'tell a screen that is refreshing from one that has quietly stopped.';

-- The lifecycle guard has to cover the new columns or it is worse than useless.
--
-- 0038 section 3 closed exactly this hole for pairing_code_hash: devices_update
-- gates only on is_brand_owner/at_location, so without this a location_manager
-- could plant a refresh_secret_hash whose preimage they chose and mint display
-- or kiosk tokens for any device at their location, indefinitely and without
-- pairing. The service role carries no jwt_role and is unaffected.
create or replace function app.protect_device_lifecycle() returns trigger
language plpgsql security invoker set search_path = '' as $$
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
       or new.location_id is distinct from old.location_id
       or new.refresh_secret_hash is distinct from old.refresh_secret_hash
       or new.refresh_secret_issued_at is distinct from old.refresh_secret_issued_at
       or new.refresh_secret_previous_hash is distinct from old.refresh_secret_previous_hash
       or new.refresh_secret_previous_expires_at is distinct from old.refresh_secret_previous_expires_at
       or new.refresh_secret_last_used_at is distinct from old.refresh_secret_last_used_at then
      raise exception 'a device lifecycle is managed by the pairing service; only its label may be edited here';
    end if;
  end if;
  return new;
end $$;

-- Revocation clears the secret as well as bumping the version, so a revoked
-- screen cannot mint itself a replacement token from a secret it still holds.
-- Enforced in the database rather than only in revokeDevice(), because the
-- service role is what runs that path and nothing else would catch a miss.
create or replace function app.clear_revoked_device_secrets() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.revoked_at is not null and old.revoked_at is null then
    new.refresh_secret_hash := null;
    new.refresh_secret_previous_hash := null;
    new.refresh_secret_previous_expires_at := null;
  end if;
  return new;
end $$;

drop trigger if exists devices_clear_revoked_secrets on public.devices;
create trigger devices_clear_revoked_secrets
  before update on public.devices
  for each row execute function app.clear_revoked_device_secrets();

-- ---------------------------------------------------------------------------
-- Readiness link.
--
-- verify.yml derives the expected readiness from the newest migration filename,
-- so every migration extends the chain or the release gate fails closed.

alter function public.platform_release_readiness()
  rename to platform_release_readiness_20260828192003;
alter function public.platform_release_readiness_20260828192003() set schema app;
revoke all on function app.platform_release_readiness_20260828192003()
  from public, anon, authenticated;
grant execute on function app.platform_release_readiness_20260828192003()
  to service_role;

create or replace function public.platform_release_readiness()
returns text language plpgsql stable security invoker set search_path = '' as $$
declare guarded_column_count integer;
begin
  if app.platform_release_readiness_20260828192003() <> '20260828192003' then
    raise exception 'repaired readiness prerequisite is incomplete';
  end if;

  select count(*) into guarded_column_count
  from pg_catalog.pg_attribute attribute
  join pg_catalog.pg_class class on class.oid = attribute.attrelid
  join pg_catalog.pg_namespace namespace on namespace.oid = class.relnamespace
  where namespace.nspname = 'public'
    and class.relname = 'devices'
    and not attribute.attisdropped
    and attribute.attname = any (array[
      'refresh_secret_hash', 'refresh_secret_issued_at',
      'refresh_secret_previous_hash', 'refresh_secret_previous_expires_at',
      'refresh_secret_last_used_at'
    ]);
  if guarded_column_count <> 5 then
    raise exception 'device refresh secret columns are incomplete';
  end if;

  -- The guard is the whole security argument for those columns, so assert the
  -- trigger function actually names them rather than trusting that it was
  -- edited alongside the schema.
  if pg_catalog.pg_get_functiondef('app.protect_device_lifecycle()'::pg_catalog.regprocedure)
     not like '%refresh_secret_hash%' then
    raise exception 'device lifecycle guard does not cover the refresh secret';
  end if;

  if pg_catalog.to_regprocedure('app.clear_revoked_device_secrets()') is null then
    raise exception 'revoked devices do not clear their refresh secret';
  end if;

  -- Both guards run under a caller-supplied search_path unless it is pinned,
  -- and app.jwt_role is exactly the call a planted schema would want to shadow.
  if exists (
    select 1 from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app'
      and p.proname in ('protect_device_lifecycle', 'clear_revoked_device_secrets')
      and coalesce(array_to_string(p.proconfig, ','), '') not like '%search_path%'
  ) then
    raise exception 'device guards do not pin search_path';
  end if;

  return '20260829180000';
end $$;
revoke all on function public.platform_release_readiness()
  from public, anon, authenticated;
grant execute on function public.platform_release_readiness()
  to service_role;
