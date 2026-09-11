import { DEMO_DEVICES, DEMO_SESSION, type DeviceSummary, type LocationSummary } from './demo-data';
import { deviceSummariesOf, locationSummariesOf, type DeviceRowLike, type LocationRowLike } from './live-mappers';
import { DEMO_MULTI_LOCATION } from './capabilities';
import { serverClient } from './supabase-server';
import { selectedOrgId } from './workspace-location';
import { demoLocationsFor } from './demo-locations';
import { liveScope } from './live-scope';
import { demoFixture, locationNames } from './data-shared';

/**
 * Whether the selected brand may run more than one location.
 *
 * Gates the "add location" affordance, which is a WRITE capability -- so the
 * two cases are kept apart the way lib/capabilities keeps them apart. No
 * client is demo/fixture mode and resolves to the demo answer; a configured
 * deployment that asked and did not get an answer grants nothing. This used to
 * return a bare `true` for both, which meant a production deployment that lost
 * its Supabase env handed every brand owner unlimited location creation.
 *
 * Not a module: LEGACY_FLAG_MODULE_MAP deliberately leaves `multi_location`
 * unmapped, because how many sites a tenant runs is a capacity setting on the
 * brands row rather than a capability, so this still reads the column.
 */
export async function loadMultiLocationEnabled(): Promise<boolean> {
  const client = await serverClient();
  if (!client) return DEMO_MULTI_LOCATION;
  const scope = await liveScope(client);
  if (!scope.orgId) return false;
  const orgId = scope.orgId;
  const row = await client.from('brands').select('multi_location').eq('id', orgId)
    .maybeSingle<{ multi_location: boolean }>();
  return row.error ? false : row.data?.multi_location === true;
}

export async function loadLocations(): Promise<LocationSummary[]> {
  const client = await serverClient();
  if (!client) {
    // The selected demo org's in-memory stores survive for the session.
    const orgId = (await selectedOrgId()) ?? DEMO_SESSION.brandId;
    return demoLocationsFor(orgId);
  }
  const scope = await liveScope(client);
  if (!scope.orgId) return [];
  // `square_connection_id` is NOT selected: 0040 revokes it from
  // `authenticated` at column level, and this client is the signed-in user, so
  // naming it here makes the whole query fail with "permission denied for
  // column". Whether a location can take a card comes from the view built for
  // it -- `location_square_status` is a security-barrier view over
  // square_connections, filtered by `app.is_brand_staff`, and only its WRITES
  // were revoked.
  const [rows, square] = await Promise.all([
    client
      .from('locations')
      .select('id, name, address, timezone, ordering_paused, hours')
      .eq('brand_id', scope.orgId)
      .order('created_at')
      .returns<Omit<LocationRowLike, 'square_connection_id'>[]>(),
    client
      .from('location_square_status')
      .select('location_id')
      .eq('brand_id', scope.orgId)
      .returns<{ location_id: string }[]>(),
  ]);
  if (rows.error) throw new Error(`locations: ${rows.error.message}`);
  if (square.error) throw new Error(`location_square_status: ${square.error.message}`);

  const connected = new Set((square.data ?? []).map((row) => row.location_id));
  return locationSummariesOf(
    (rows.data ?? []).map((row) => ({
      ...row,
      square_connection_id: connected.has(row.id) ? row.id : null,
    })),
  );
}

/**
 * Every screen in the brand, newest first.
 *
 * Deliberately brand-wide: `devices_select` already admits staff brand-wide,
 * and an operator who cannot see
 * the display at the other store cannot tell you it has stopped. What is
 * location-scoped is doing something to one -- that check lives in
 * lib/device-admin and runs on every write.
 */
export async function loadDevices(): Promise<DeviceSummary[]> {
  const client = await serverClient();
  if (!client) return demoFixture(DEMO_DEVICES, []);
  const scope = await liveScope(client);
  if (!scope.orgId || scope.locationIds.length === 0) return [];
  const [rows, names] = await Promise.all([
    client
      .from('devices')
      .select('id, location_id, role, label, paired_at, revoked_at, last_seen_at, '
        + 'refresh_secret_hash, refresh_secret_issued_at, refresh_secret_last_used_at')
      .eq('brand_id', scope.orgId)
      .in('location_id', [...scope.locationIds])
      .order('created_at', { ascending: false })
      .returns<DeviceRowLike[]>(),
    locationNames(client, scope.orgId),
  ]);
  if (rows.error) throw new Error(`devices: ${rows.error.message}`);
  return deviceSummariesOf(rows.data ?? [], names);
}
