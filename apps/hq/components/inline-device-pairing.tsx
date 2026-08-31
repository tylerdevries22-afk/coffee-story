'use client';

import Link from 'next/link';
import { useActionState } from 'react';

import { DEVICE_ROLES } from '@platform/schema';

import { pairDeviceAction } from '@/app/(console)/locations/device-actions';
import { IDLE } from '@/lib/device-action-state';

type Props = {
  configured: boolean;
  location: { id: string; name: string };
  squareDeferred: boolean;
  squareHref: string | null;
};

export function InlineDevicePairing({ configured, location, squareDeferred, squareHref }: Props) {
  const [state, pair, pairing] = useActionState(pairDeviceAction, IDLE);
  return (
    <section className="card location-onboarding-result">
      <p className="factory-eyebrow">Location created</p>
      <h2>Connect {location.name}</h2>
      <p className="subtitle">
        Create the first one-time device code now, then continue to Square when this is the
        organization attached to your current session.
      </p>
      {state.kind === 'error' ? <div className="notice danger" role="alert">{state.message}</div> : null}
      {state.kind === 'paired' ? (
        <div className="notice" role="status">
          <strong>Pairing code</strong>
          <code className="device-secret">{state.code}</code>
          <p>Copy it now. Only its fingerprint is stored, and the code expires at {state.expiresAt}.</p>
        </div>
      ) : null}
      <form action={pair} className="device-pair-form">
        <input name="locationId" type="hidden" value={location.id} />
        <label>Role
          <select defaultValue="display" name="role" required>
            {DEVICE_ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
          </select>
        </label>
        <label>Label
          <input maxLength={60} name="label" placeholder="Pickup board" required />
        </label>
        <button className="button" disabled={pairing || !configured} type="submit">
          {pairing ? 'Creating…' : 'Create pairing code'}
        </button>
      </form>
      {!configured ? <p className="muted">Device pairing becomes available after Supabase and its signing key are configured.</p> : null}
      {squareDeferred ? <div className="notice">Square setup is deferred until you use this organization’s home-tenant session.</div> : null}
      <div className="location-form-actions">
        <Link className="button secondary" href="/locations">Finish later</Link>
        {squareHref ? <a className="button" href={squareHref}>Continue to Square</a> : null}
      </div>
    </section>
  );
}
