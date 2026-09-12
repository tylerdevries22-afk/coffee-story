import {
  offboardOrganizationAction,
  restoreOrganizationAction,
  suspendOrganizationAction,
} from '../lifecycle-actions';

export function LifecyclePanel({ brandId, brandStatus }: { brandId: string; brandStatus: string }) {
  return (
    <div className="card">
      <h2>Lifecycle</h2>
      <p className="muted">
        Suspend pauses access without deleting data. Offboard is terminal.
        Hard deletion of provider projects stays a manual operator step.
      </p>
      {brandStatus === 'active' || brandStatus === 'suspended' ? (
        <div style={{ display: 'grid', gap: '1rem', maxWidth: '32rem' }}>
          {brandStatus === 'active' ? (
            <form action={suspendOrganizationAction} className="location-form">
              <input type="hidden" name="brandId" value={brandId} />
              <label>
                Suspension reason
                <input name="reason" required minLength={4} maxLength={500} placeholder="Why this organization is being suspended" />
              </label>
              <button type="submit" className="button danger">Suspend organization</button>
            </form>
          ) : (
            <form action={restoreOrganizationAction}>
              <input type="hidden" name="brandId" value={brandId} />
              <button type="submit" className="button">Restore organization</button>
            </form>
          )}
          <form action={offboardOrganizationAction} className="location-form">
            <input type="hidden" name="brandId" value={brandId} />
            <label>
              Offboard reason
              <input name="reason" required minLength={4} maxLength={500} placeholder="Why this organization is ending" />
            </label>
            <button type="submit" className="button danger">Offboard organization</button>
          </form>
        </div>
      ) : (
        <p className="muted">Lifecycle controls apply after activation (current status: {brandStatus}).</p>
      )}
    </div>
  );
}
