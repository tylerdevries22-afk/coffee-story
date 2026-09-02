'use client';

import type { DeviceAppTarget } from '@platform/device-wall';

import { Icon } from '@/components/icon';
import type { AddedDevice } from '@/components/device-wall/add-device-wizard';
import { AddDeviceWizard } from '@/components/device-wall/add-device-wizard';
import { DeviceStudio } from '@/components/device-wall/device-studio';
import type { DeviceWallView, WallInstallation } from '@/lib/device-wall-data';

const APP_LABEL: Readonly<Record<DeviceAppTarget, string>> = {
  operator: 'Operator', pickup_queue: 'Pickup Queue', kiosk_pos: 'Kiosk / POS',
};

function lastSeen(value: string | null) {
  if (!value) return 'Awaiting first heartbeat';
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(value)) / 1_000));
  if (seconds < 60) return `Seen ${seconds}s ago`;
  if (seconds < 3_600) return `Seen ${Math.round(seconds / 60)}m ago`;
  return `Seen ${Math.round(seconds / 3_600)}h ago`;
}

function DeviceThumbnail({ installation }: { readonly installation: WallInstallation }) {
  return (
    <div aria-label={`${installation.label} ${installation.formFactor}`} className="apps-preview-table-thumb" data-form-factor={installation.formFactor} role="img">
      <span aria-hidden="true" className={`device-card-silhouette device-card-silhouette--${installation.formFactor}`} />
    </div>
  );
}

type DeviceTableProps = {
  readonly devices: readonly WallInstallation[];
  readonly onAdd: (device: AddedDevice) => void;
  readonly onConnect: (installationId: string) => void;
  readonly selected: WallInstallation | null;
  readonly view: DeviceWallView;
};

/** A compact projection of the same Device Wall inventory used by the wall view. */
export function AppsPreviewTable(props: DeviceTableProps) {
  const disabled = !props.view.canManage || !props.view.policy.enabled || props.view.locations.length === 0;
  return (
    <div className="apps-preview-table-surface">
      <section aria-labelledby="production-device-table-title" className="apps-preview-table">
        <header className="apps-preview-table-header">
          <div>
            <span className="device-wall-kicker">Production device wall</span>
            <h2 id="production-device-table-title">Device inventory</h2>
            <p>Secure installations and their live connection status.</p>
          </div>
          <AddDeviceWizard disabled={disabled} locations={props.view.locations} onAdded={props.onAdd} policy={props.view.policy} />
        </header>
        <ol>
          {props.devices.map((installation) => (
            <li className="apps-preview-table-row" data-status={installation.connectionState} key={installation.id}>
              <DeviceThumbnail installation={installation} />
              <div className="apps-preview-table-copy">
                <strong>{installation.label}</strong>
                <span>{installation.locationName} · {APP_LABEL[installation.appTarget]}</span>
                <small>{installation.platform} · v{installation.appVersion} · {lastSeen(installation.lastSeenAt)}</small>
              </div>
              <span className="apps-preview-table-source" data-status={installation.connectionState}>{installation.connectionState}</span>
              <div className="apps-preview-table-actions">
                <span>{installation.capabilities.length} capabilities</span>
                <button className="device-wall-secondary" disabled={!props.view.canManage} onClick={() => props.onConnect(installation.id)} type="button"><Icon name="activity" size={14} /> Connect</button>
              </div>
            </li>
          ))}
        </ol>
      </section>
      {props.selected ? <aside aria-label={`${props.selected.label} device twin`} className="apps-preview-table-twin"><DeviceStudio installation={props.selected} /></aside> : null}
    </div>
  );
}
