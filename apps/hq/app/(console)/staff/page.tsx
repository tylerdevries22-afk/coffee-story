import { redirect } from 'next/navigation';

import { currentSession, hasRole } from '@/lib/auth';
import { loadStaffDirectory } from '@/lib/staff-directory';

import { inviteStaffAction, removeStaffAction, updateStaffAction } from './actions';

export const dynamic = 'force-dynamic';

const NOTICES: Record<string, string> = {
  changed: 'Staff access was updated. The new scope takes effect after the next session refresh.',
  prepared: 'Access is prepared. The recipient can use the invitation or refresh an existing session.',
  removed: 'Staff access was removed. Any existing session will lose access on refresh.',
};

type StaffPageProps = { searchParams: Promise<{ error?: string; updated?: string }> };

function LocationChecks({
  locations, selected = [],
}: {
  locations: { id: string; name: string }[];
  selected?: readonly string[];
}) {
  return (
    <fieldset className="location-form-days">
      <legend>Location access (required for managers and staff)</legend>
      {locations.map((location) => (
        <label key={location.id} className="location-form-day">
          <input type="checkbox" name="locationIds" value={location.id} defaultChecked={selected.includes(location.id)} />
          {location.name}
        </label>
      ))}
    </fieldset>
  );
}

export default async function StaffPage({ searchParams }: StaffPageProps) {
  const [session, params] = await Promise.all([currentSession(), searchParams]);
  if (!session || !hasRole(session, 'brand_owner')) redirect('/');
  const directory = await loadStaffDirectory(session);

  return (
    <>
      <h1>Staff access</h1>
      <p className="subtitle">Invite people once, then keep their organization role and location scope explicit.</p>
      {params.error ? <div className="notice danger" role="status">{params.error}</div> : null}
      {params.updated && NOTICES[params.updated] ? <div className="notice" role="status">{NOTICES[params.updated]}</div> : null}
      {!directory.configured ? (
        <div className="notice">Connect Supabase and set NEXT_PUBLIC_HQ_URL to send staff invitations.</div>
      ) : (
        <div className="grid-2">
          <section className="card">
            <h2>Invite a team member</h2>
            <form action={inviteStaffAction} className="location-form">
              <label className="field">Email<input name="email" type="email" required maxLength={254} autoComplete="email" /></label>
              <label className="field">Role
                <select name="role" defaultValue="staff">
                  <option value="staff">Staff</option>
                  <option value="location_manager">Location manager</option>
                  <option value="brand_owner">Brand owner</option>
                </select>
              </label>
              <LocationChecks locations={directory.locations} />
              <button type="submit" className="button">Send invitation</button>
            </form>
          </section>
          <section>
            <h2>Current team</h2>
            {directory.members.length === 0 ? <div className="notice">No staff accounts yet.</div> : null}
            {directory.members.map((member) => (
              <form action={updateStaffAction} className="card location-form" key={member.id}>
                <input type="hidden" name="userId" value={member.userId} />
                <h3>{member.email}</h3>
                <label className="field">Role
                  <select name="role" defaultValue={member.role} disabled={member.role === 'platform_admin'}>
                    <option value="staff">Staff</option>
                    <option value="location_manager">Location manager</option>
                    <option value="brand_owner">Brand owner</option>
                    {member.role === 'platform_admin' ? <option value="platform_admin">Platform admin</option> : null}
                  </select>
                </label>
                {member.role !== 'platform_admin' ? <LocationChecks locations={directory.locations} selected={member.locationIds} /> : null}
                {member.role !== 'platform_admin' ? (
                  <div className="location-form-actions">
                    <button className="button secondary" type="submit">Save access</button>
                    <button className="button danger" type="submit" formAction={removeStaffAction}>Remove</button>
                  </div>
                ) : <p className="muted">Platform administrator access is managed outside brand settings.</p>}
              </form>
            ))}
          </section>
        </div>
      )}
    </>
  );
}
