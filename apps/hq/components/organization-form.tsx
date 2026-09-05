'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';

import { createOrganizationAction } from '@/app/(console)/organizations/actions';
import { ORGANIZATION_IDLE } from '@/lib/organization-action-state';
import { WEEKDAYS } from '@/lib/location-input';

const TIMEZONES = [
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix',
  'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu',
  'America/Toronto', 'Europe/London', 'Europe/Paris', 'Australia/Sydney',
];
const DAY_LABEL: Record<string, string> = {
  mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun',
};
const BLUEPRINT_MODULES: Record<string, readonly string[]> = {
  blank: [],
  'coffee-shop': ['Catalog', 'Ordering', 'Payments', 'Operations', 'Training', 'Device wall'],
  construction: [
    'Projects', 'Operations', 'Knowledge and training', 'Materials catalog',
    'Client requests', 'Payments', 'Jobsite printing', 'Device wall',
  ],
};

export function OrganizationForm({ idempotencyKey }: { idempotencyKey: string }) {
  const [state, submit, pending] = useActionState(createOrganizationAction, ORGANIZATION_IDLE);
  const [kind, setKind] = useState('independent');
  const [industry, setIndustry] = useState('general');
  const [blueprint, setBlueprint] = useState('blank');
  const needsLocation = kind === 'independent' || kind === 'franchisee';

  return (
    <form action={submit} className="location-form" aria-busy={pending}>
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <div className="location-form-row">
        <label className="field">
          Organization name
          <input name="name" required maxLength={120} placeholder="e.g. Harbor Bakery" autoFocus />
        </label>
        <label className="field">
          Owner email
          <input name="ownerEmail" type="email" required maxLength={254} autoComplete="email" />
        </label>
      </div>
      <div className="location-form-row">
        <label className="field">
          Organization model
          <select name="organizationKind" value={kind} onChange={(event) => setKind(event.target.value)}>
            <option value="independent">Independent business</option>
            <option value="franchisor">Franchisor / network owner</option>
            <option value="franchisee">Franchisee</option>
            <option value="operator">Management operator</option>
          </select>
        </label>
        <label className="field">
          Industry
          <select name="industryKey" value={industry} onChange={(event) => {
            const value = event.target.value;
            setIndustry(value);
            setBlueprint(value === 'construction' ? 'construction' : value === 'coffee-shop' ? 'coffee-shop' : 'blank');
          }}>
            <option value="general">General</option>
            <option value="coffee-shop">Coffee shop / hospitality</option>
            <option value="construction">Construction</option>
          </select>
        </label>
        <label className="field">
          Starting blueprint
          <select name="blueprintKey" value={blueprint} onChange={(event) => setBlueprint(event.target.value)}>
            <option value="blank">Blank — no modules</option>
            <option value="coffee-shop">Coffee commerce</option>
            <option value="construction">Construction operations</option>
          </select>
        </label>
      </div>
      <div className="notice" role="status">
        <strong>{blueprint === 'blank' ? 'No modules selected' : 'Modules installed by this blueprint'}</strong>
        {BLUEPRINT_MODULES[blueprint]?.length ? (
          <p className="muted">{BLUEPRINT_MODULES[blueprint].join(' · ')}</p>
        ) : <p className="muted">Choose an industry blueprint now or install modules later.</p>}
      </div>

      {kind === 'franchisee' ? (
        <div className="location-form-row">
          <label className="field">
            Franchise network handle
            <input name="networkSlug" required placeholder="e.g. harbor-coffee" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" />
          </label>
          <label className="field">
            Territory
            <input name="territory" maxLength={500} placeholder="e.g. North Denver" />
          </label>
        </div>
      ) : null}

      {needsLocation ? (
        <fieldset className="organization-location-fields">
          <legend>First location</legend>
          <label className="field">
            Location name
            <input name="locationName" required maxLength={120} placeholder="e.g. Downtown" />
          </label>
          <div className="location-form-row">
            <label className="field">Street<input name="street" autoComplete="street-address" /></label>
            <label className="field">City<input name="city" autoComplete="address-level2" /></label>
          </div>
          <div className="location-form-row">
            <label className="field">Region / state<input name="region" autoComplete="address-level1" /></label>
            <label className="field">Postal code<input name="postal" autoComplete="postal-code" /></label>
          </div>
          <label className="field">
            Timezone
            <select name="timezone" defaultValue="America/Denver" required>
              {TIMEZONES.map((zone) => <option key={zone}>{zone}</option>)}
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
            <label className="field">Opens<input name="openTime" type="time" defaultValue="08:00" required /></label>
            <label className="field">Closes<input name="closeTime" type="time" defaultValue="18:00" required /></label>
          </div>
        </fieldset>
      ) : null}

      {state.kind === 'error' ? <div className="notice danger" role="alert">{state.message}</div> : null}
      <div className="location-form-actions">
        <Link href="/" className="button secondary" aria-disabled={pending}>Cancel</Link>
        <button type="submit" className="button" disabled={pending}>
          {pending ? 'Provisioning…' : 'Create organization'}
        </button>
      </div>
    </form>
  );
}
