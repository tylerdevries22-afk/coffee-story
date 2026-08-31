import Link from 'next/link';
import { redirect } from 'next/navigation';

import { currentSession, hasRole } from '@/lib/auth';
import { WEEKDAYS } from '@/lib/location-input';

import { createLocationAction } from '../actions';

// Live surface behind a session; never prerender.
export const dynamic = 'force-dynamic';

// A short, curated timezone list keeps the common cases one click away; the
// field still accepts any IANA zone the parser validates.
const TIMEZONES = [
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix',
  'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu',
  'America/Toronto', 'Europe/London', 'Europe/Paris', 'Australia/Sydney',
];

const DAY_LABEL: Record<string, string> = {
  mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun',
};

type NewLocationPageProps = { searchParams: Promise<{ error?: string }> };

export default async function NewLocationPage({ searchParams }: NewLocationPageProps) {
  const [session, params] = await Promise.all([currentSession(), searchParams]);
  // Only an owner (or platform admin) may add a store; a manager can run one
  // but not create another. The write is checked again by RLS.
  if (!session || !hasRole(session, 'brand_owner')) redirect('/locations');

  return (
    <>
      <h1>Add a location</h1>
      <p className="subtitle">
        A new location starts blank — only what you enter here. Connect Square and
        pair devices from the locations list once it’s created.
      </p>
      {params.error ? <div className="notice danger" role="status">{params.error}</div> : null}
      <div className="card">
        <form action={createLocationAction} className="location-form">
          <label className="field">
            Location name
            <input name="name" required maxLength={120} placeholder="e.g. River North" />
          </label>
          <div className="location-form-row">
            <label className="field">
              Street
              <input name="street" placeholder="Street address" />
            </label>
            <label className="field">
              City
              <input name="city" placeholder="City" />
            </label>
          </div>
          <div className="location-form-row">
            <label className="field">
              Region / state
              <input name="region" placeholder="State or province" />
            </label>
            <label className="field">
              Postal code
              <input name="postal" placeholder="ZIP or postal code" />
            </label>
          </div>
          <label className="field">
            Timezone
            <select name="timezone" defaultValue="America/New_York" required>
              {TIMEZONES.map((zone) => <option key={zone} value={zone}>{zone}</option>)}
            </select>
          </label>
          <fieldset className="location-form-days">
            <legend>Open days</legend>
            {WEEKDAYS.map((day) => (
              <label key={day} className="location-form-day">
                <input type="checkbox" name="days" value={day} defaultChecked={day !== 'sun'} />
                {DAY_LABEL[day]}
              </label>
            ))}
          </fieldset>
          <div className="location-form-row">
            <label className="field">
              Opens
              <input name="openTime" type="time" defaultValue="08:00" required />
            </label>
            <label className="field">
              Closes
              <input name="closeTime" type="time" defaultValue="20:00" required />
            </label>
          </div>
          <label className="location-form-check">
            <input type="checkbox" name="connectSquare" defaultChecked />
            Continue to Square connection after creating
          </label>
          <div className="location-form-actions">
            <Link href="/locations" className="button secondary">Cancel</Link>
            <button type="submit" className="button">Create location</button>
          </div>
        </form>
      </div>
    </>
  );
}
