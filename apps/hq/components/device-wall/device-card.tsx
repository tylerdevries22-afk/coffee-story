'use client';

import type { WallInstallation } from '@/lib/device-wall-data';
import { Icon } from '@/components/icon';

const APP_LABEL = { operator: 'Operator', pickup_queue: 'Pickup Queue', kiosk_pos: 'Kiosk / POS' } as const;

function lastSeen(value: string | null) {
  if (!value) return 'Awaiting first heartbeat';
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(value)) / 1_000));
  if (seconds < 60) return `Seen ${seconds}s ago`;
  if (seconds < 3_600) return `Seen ${Math.round(seconds / 60)}m ago`;
  return `Seen ${Math.round(seconds / 3_600)}h ago`;
}

export function DeviceCard(props: {
  readonly installation: WallInstallation;
  readonly selected: boolean;
  readonly canArrange: boolean;
  readonly canConnect: boolean;
  readonly onConnect: () => void;
  readonly onSelect: () => void;
  readonly onMove: (direction: -1 | 1) => void;
}) {
  const device = props.installation;
  return (
    <article className="device-wall-card" data-selected={props.selected} data-status={device.connectionState}>
      <button className="device-wall-card-main" type="button" onClick={props.onSelect} aria-pressed={props.selected}>
        <span className={`device-card-silhouette device-card-silhouette--${device.formFactor}`} aria-hidden="true" />
        <span className="device-card-copy">
          <span className="device-card-title"><strong>{device.label}</strong><em>{device.connectionState}</em></span>
          <span>{device.locationName} · {APP_LABEL[device.appTarget]}</span>
          <small>{lastSeen(device.lastSeenAt)}</small>
        </span>
      </button>
      <div className="device-card-meta">
        <span>{device.platform} · v{device.appVersion}</span>
        <span>{device.capabilities.length} capabilities</span>
        <button className="device-wall-connect" disabled={!props.canConnect} onClick={props.onConnect} type="button"><Icon name="activity" size={14} /> Connect</button>
        {props.canArrange ? (
          <span className="device-card-order">
            <button type="button" onClick={() => props.onMove(-1)} aria-label={`Move ${device.label} earlier`}>←</button>
            <button type="button" onClick={() => props.onMove(1)} aria-label={`Move ${device.label} later`}>→</button>
          </span>
        ) : null}
      </div>
    </article>
  );
}
