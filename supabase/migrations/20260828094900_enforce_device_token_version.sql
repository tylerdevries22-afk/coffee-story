-- Re-pairing a screen increments devices.token_version. The service-role API
-- already compared that version, but direct PostgREST reads only checked that
-- the device row was paired and not revoked. An older token could therefore
-- continue reading after re-pairing until its JWT expired.
create or replace function app.device_is_active(wanted_role app.device_role)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.devices device
    where device.id = app.jwt_device_id()
      and device.role = wanted_role
      and device.revoked_at is null
      and device.paired_at is not null
      and device.brand_id = app.jwt_brand_id()
      and device.location_id = app.jwt_device_location()
      and device.token_version = nullif(
        app.jwt_claims() ->> 'device_token_version',
        ''
      )::integer
  )
$$;

revoke all on function app.device_is_active(app.device_role)
  from public, anon;
grant execute on function app.device_is_active(app.device_role)
  to authenticated, service_role;
