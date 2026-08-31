import Link from 'next/link';

import { DevicePanel, type DevicePanelDevice } from '@/components/device-panel';
import { currentClaims, currentSession, hasRole } from '@/lib/auth';
import { loadDevices, loadLocations, loadMultiLocationEnabled } from '@/lib/data';
import { squareConnectNotice } from '@/lib/square-connect-notice';
import { mayManageWorkspaceLocation } from '@/lib/workspace-location-access';
import { selectedOrganizationId } from '@/lib/workspace-scope';

import { disconnectSquareAction } from './actions';

// The console is live data behind a session: never prerender a fixture
// snapshot at build time and serve it as if it were today's numbers.
export const dynamic = 'force-dynamic';


type LocationsPageProps = {
  searchParams: Promise<{ connected?: string; square?: string; disconnect?: string; created?: string }>;
};

const CREATED_NOTICE: Record<string, { message: string; failed: boolean }> = {
  '1': { message: 'Location created. Connect Square and pair its devices below.', failed: false },
  denied: { message: 'Only a brand owner can add a location.', failed: true },
  limit: { message: 'This organization is limited to one location.', failed: true },
  failed: { message: 'That location could not be created. Try again.', failed: true },
  square_deferred: {
    message: 'Location created. Connect Square from that organization’s home-tenant session, then pair its devices below.',
    failed: false,
  },
};

export default async function LocationsPage({ searchParams }: LocationsPageProps) {
  const [locations, devices, claims, session, multiLocation, params] = await Promise.all([
    loadLocations(), loadDevices(), currentClaims(), currentSession(), loadMultiLocationEnabled(), searchParams,
  ]);
  // Square consent redirects back here, and it can come back refused.
  const notice = squareConnectNotice(params);
  const createdNotice = params.created ? CREATED_NOTICE[params.created] ?? null : null;
  const selectedBrandId = session ? await selectedOrganizationId(session) : null;
  // An owner may add a store only when the brand is licensed for more than one.
  const canAddLocation = hasRole(session, 'brand_owner') && (multiLocation || locations.length === 0);
  // Whether a control is drawn; never whether the write is allowed. The same
  // check runs again in lib/device-admin, against the same claims.
  const manages = (locationId: string) => mayManageWorkspaceLocation(
    selectedBrandId, claims, locationId,
  );
  const panelDevices: DevicePanelDevice[] = devices.map((device) => ({
    ...device, manageable: manages(device.locationId),
  }));
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Locations</h1>
          <p className="subtitle">Each location connects its own Square account; tokens never leave the server.</p>
        </div>
        {canAddLocation ? <Link href="/locations/new" className="button">Add location</Link> : null}
      </div>
      {notice ? (
        <div className={notice.failed ? 'notice danger' : 'notice'} role="status">{notice.message}</div>
      ) : null}
      {createdNotice ? (
        <div className={createdNotice.failed ? 'notice danger' : 'notice'} role="status">{createdNotice.message}</div>
      ) : null}
      <div className="card">
        <table>
          <thead>
            <tr><th>Location</th><th>Hours</th><th>Square</th><th>Ordering</th><th /></tr>
          </thead>
          <tbody>
            {locations.map((location) => (
              <tr key={location.id}>
                <td>
                  <strong>{location.name}</strong>
                  <br />
                  <span style={{ color: 'var(--text-muted)' }}>{location.city} · {location.timezone}</span>
                </td>
                <td>{location.hours}</td>
                <td>
                  {location.squareConnected
                    ? <span className="pill success">Connected</span>
                    : <span className="pill warning">Not connected</span>}
                </td>
                <td>
                  {location.orderingPaused
                    ? <span className="pill danger">Paused</span>
                    : <span className="pill success">Taking orders</span>}
                </td>
                <td className="num">
                  {!manages(location.id) ? null : location.squareConnected ? (
                    // Drawn only for a manager of this shop, and checked again
                    // in lib/square-admin against the same claims. A shop that
                    // changes hands, or a merchant account that is compromised,
                    // needs its token revoked from here -- the runbook's manual
                    // procedure named an engine function nobody could call.
                    <form action={disconnectSquareAction}>
                      <input type="hidden" name="locationId" value={location.id} />
                      <button type="submit" className="button danger">Disconnect Square</button>
                    </form>
                  ) : (
                    // Phase 7's engine serves this route: it redirects into
                    // Square's OAuth consent and stores the tokens encrypted.
                    <a className="button secondary" href={`/api/square/connect?location_id=${location.id}`}>
                      Connect Square
                    </a>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <DevicePanel
        configured={claims !== null}
        devices={panelDevices}
        pairableLocations={locations.filter((location) => manages(location.id))
          .map((location) => ({ id: location.id, name: location.name }))}
      />
    </>
  );
}
