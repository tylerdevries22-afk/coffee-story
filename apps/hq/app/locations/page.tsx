import { DEMO_LOCATIONS } from '@/lib/demo-data';

export default function LocationsPage() {
  return (
    <>
      <h1>Locations</h1>
      <p className="subtitle">Each location connects its own Square account; tokens never leave the server.</p>
      <div className="card">
        <table>
          <thead>
            <tr><th>Location</th><th>Hours</th><th>Square</th><th>Ordering</th><th /></tr>
          </thead>
          <tbody>
            {DEMO_LOCATIONS.map((location) => (
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
      <div className="notice">
        Add a location from Onboarding — it creates the row, seeds hours, and
        walks Square connection in one pass.
      </div>
    </>
  );
}
