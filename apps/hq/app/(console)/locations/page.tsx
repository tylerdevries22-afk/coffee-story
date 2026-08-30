import { canManageLocation } from '@platform/schema';

import { DevicePanel, type DevicePanelDevice } from '@/components/device-panel';
import { currentClaims } from '@/lib/auth';
import { loadDevices, loadLocations } from '@/lib/data';
import { squareConnectNotice } from '@/lib/square-connect-notice';
// The console is live data behind a session: never prerender a fixture
// snapshot at build time and serve it as if it were today's numbers.
export const dynamic = 'force-dynamic';


type LocationsPageProps = {
  searchParams: Promise<{ connected?: string; square?: string }>;
};

export default async function LocationsPage({ searchParams }: LocationsPageProps) {
  const [locations, devices, claims, params] = await Promise.all([
    loadLocations(), loadDevices(), currentClaims(), searchParams,
  ]);
  // Square consent redirects back here, and it can come back refused.
  const notice = squareConnectNotice(params);
  // Whether a control is drawn; never whether the write is allowed. The same
  // check runs again in lib/device-admin, against the same claims.
  const manages = (locationId: string) => claims !== null && canManageLocation(claims, locationId);
  const panelDevices: DevicePanelDevice[] = devices.map((device) => ({
    ...device, manageable: manages(device.locationId),
  }));
  return (
    <>
      <h1>Locations</h1>
      <p className="subtitle">Each location connects its own Square account; tokens never leave the server.</p>
      {notice ? (
        <div className={notice.failed ? 'notice danger' : 'notice'} role="status">{notice.message}</div>
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
                  {location.squareConnected ? null : (
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
      <div className="notice">
        Add a location from Onboarding — it creates the row, seeds hours, and
        walks Square connection in one pass.
      </div>
    </>
  );
}
