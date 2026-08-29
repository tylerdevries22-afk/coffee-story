'use client';

import { useActionState } from 'react';

import { DEVICE_ROLES } from '@platform/schema';

import {
  issueRefreshSecretAction, pairDeviceAction, revokeDeviceAction,
} from '@/app/(console)/locations/actions';
import { IDLE, type DeviceActionState } from '@/lib/device-action-state';
import type { DeviceSummary } from '@/lib/demo-data';

/**
 * `manageable` is decided on the server from the caller's own claims and only
 * hides controls. The same check runs again in lib/device-admin on every write,
 * because a hidden button is a courtesy and not a permission.
 */
export type DevicePanelDevice = DeviceSummary & { manageable: boolean };

type Props = {
  devices: DevicePanelDevice[];
  pairableLocations: { id: string; name: string }[];
  configured: boolean;
};

const HEALTH: Record<DeviceSummary['health'], { pill: string; label: string }> = {
  durable: { pill: 'pill success', label: 'Durable credential' },
  expiring: { pill: 'pill warning', label: 'Twelve-hour token only' },
  unpaired: { pill: 'pill warning', label: 'Never paired' },
  revoked: { pill: 'pill danger', label: 'Revoked' },
};

function when(value: string | null): string {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toISOString().slice(0, 16).replace('T', ' ');
}

/**
 * A value shown exactly once.
 *
 * Only the HMAC is stored, so there is no second chance to read it and the
 * copy says so plainly rather than leaving an operator to discover it by
 * reloading the page.
 */
function ShownOnce({ title, value, note }: { title: string; value: string; note: string }) {
  return (
    <div className="notice" role="status">
      <strong>{title}</strong>
      <p>{note}</p>
      <code className="device-secret">{value}</code>
      <p><strong>Copy it now.</strong> Only its fingerprint is stored, so it cannot be shown again.</p>
    </div>
  );
}

function Outcome({ state }: { state: DeviceActionState }) {
  if (state.kind === 'error') return <div className="notice danger" role="alert">{state.message}</div>;
  if (state.kind === 'revoked') {
    return <div className="notice" role="status">That screen is revoked. It stops on its next request.</div>;
  }
  if (state.kind === 'paired') {
    return <ShownOnce
      title="Pairing code"
      value={state.code}
      note={`Type this into the device to finish pairing. It expires ${when(state.expiresAt)} UTC.`}
    />;
  }
  if (state.kind === 'secret') {
    return <ShownOnce
      title="Device refresh secret"
      value={state.secret}
      note={
        'Set this as DISPLAY_DEVICE_REFRESH_SECRET on the display deployment (or '
        + 'the equivalent variable on the surface that runs this screen). It survives '
        + 'a deploy, a power cut and a night switched off.'
        + (state.previousExpiresAt
          ? ` The previous secret keeps working until ${when(state.previousExpiresAt)} UTC.`
          : '')
      }
    />;
  }
  return null;
}

export function DevicePanel({ devices, pairableLocations, configured }: Props) {
  const [pairState, pair, pairing] = useActionState(pairDeviceAction, IDLE);
  const [secretState, issueSecret, issuing] = useActionState(issueRefreshSecretAction, IDLE);
  const [revokeState, revoke, revoking] = useActionState(revokeDeviceAction, IDLE);

  return (
    <section>
      <h2>Devices</h2>
      <p className="subtitle">
        Screens nobody signs into: pickup displays, kiosks, prep boards. Each holds its own
        credential, and revoking one stops it on its next request rather than at the end of the shift.
      </p>

      {!configured && (
        <div className="notice" role="status">
          <strong>Setup required.</strong> This deployment has no Supabase connection, so the
          devices below are sample rows and the controls are unavailable.
        </div>
      )}

      <Outcome state={secretState} />
      <Outcome state={revokeState} />

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Screen</th><th>Location</th><th>Credential</th><th>Paired</th><th>Last seen</th><th />
            </tr>
          </thead>
          <tbody>
            {devices.length === 0 && (
              <tr><td colSpan={6}>No devices yet. Connect one below.</td></tr>
            )}
            {devices.map((device) => (
              <tr key={device.id}>
                <td>
                  <strong>{device.label}</strong>
                  <br />
                  <span style={{ color: 'var(--text-muted)' }}>{device.role}</span>
                </td>
                <td>{device.locationName}</td>
                <td>
                  <span className={HEALTH[device.health].pill}>{HEALTH[device.health].label}</span>
                  {device.secretLastUsedAt && (
                    <>
                      <br />
                      <span style={{ color: 'var(--text-muted)' }}>
                        refreshed {when(device.secretLastUsedAt)}
                      </span>
                    </>
                  )}
                </td>
                <td>{when(device.pairedAt)}</td>
                <td>{when(device.lastSeenAt)}</td>
                <td className="num">
                  {device.manageable && device.health !== 'revoked' && (
                    <span className="device-actions">
                      <form action={issueSecret}>
                        <input name="deviceId" type="hidden" value={device.id} />
                        <button className="button secondary" disabled={issuing} type="submit">
                          {device.health === 'durable' ? 'Rotate secret' : 'Issue refresh secret'}
                        </button>
                      </form>
                      <form action={revoke}>
                        <input name="deviceId" type="hidden" value={device.id} />
                        <button className="button secondary" disabled={revoking} type="submit">
                          Revoke
                        </button>
                      </form>
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3>Connect a screen</h3>
      <Outcome state={pairState} />
      <form action={pair} className="card device-pair-form">
        <label>
          Location
          <select name="locationId" required>
            {pairableLocations.map((location) => (
              <option key={location.id} value={location.id}>{location.name}</option>
            ))}
          </select>
        </label>
        <label>
          Role
          <select defaultValue="display" name="role" required>
            {DEVICE_ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
          </select>
        </label>
        <label>
          Label
          <input maxLength={60} name="label" placeholder="Pickup board" required />
        </label>
        <button
          className="button"
          disabled={pairing || pairableLocations.length === 0 || !configured}
          type="submit"
        >
          Create pairing code
        </button>
      </form>
    </section>
  );
}
