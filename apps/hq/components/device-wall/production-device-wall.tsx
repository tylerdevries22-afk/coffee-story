'use client';

import { useState } from 'react';

import { Icon } from '@/components/icon';
import type { DeviceWallView, WallInstallation } from '@/lib/device-wall-data';

import type { AddedDevice } from './add-device-wizard';
import { AddDeviceWizard } from './add-device-wizard';
import { DeviceCard } from './device-card';
import { DiagnosticsDrawer } from './diagnostics-drawer';
import { DeviceStudio } from './device-studio';

type DeviceWallProps = {
  readonly devices: readonly WallInstallation[];
  readonly locationId: string;
  readonly onAdd: (device: AddedDevice) => void;
  readonly onConnect: (installationId: string) => void;
  readonly onLocationChange: (locationId: string) => void;
  readonly onMove: (installationId: string, direction: -1 | 1) => void;
  readonly onSelect: (installationId: string) => void;
  readonly pending: boolean;
  readonly save: () => void;
  readonly saveMessage: string;
  readonly selected: WallInstallation | null;
  readonly selectedId: string;
  readonly view: DeviceWallView;
};

export function ProductionDeviceWall(props: DeviceWallProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const disabled = !props.view.canManage || !props.view.policy.enabled || props.view.locations.length === 0;
  return (
    <section className="production-device-wall" aria-labelledby="production-device-wall-title">
      <header className="device-wall-header">
        <div>
          <span className="device-wall-kicker">Tenant module · v1</span>
          <h2 id="production-device-wall-title">Production devices</h2>
          <p>Live installations across Operator, Pickup Queue, and Kiosk / POS.</p>
        </div>
        <AddDeviceWizard disabled={disabled} locations={props.view.locations} onAdded={props.onAdd} policy={props.view.policy} />
      </header>
      <div className="device-wall-toolbar">
        <div aria-label="Filter devices by location" className="device-wall-filter" role="group">
          <button data-active={props.locationId === 'all'} onClick={() => props.onLocationChange('all')} type="button">All locations</button>
          {props.view.locations.map((location) => <button data-active={props.locationId === location.id} key={location.id} onClick={() => props.onLocationChange(location.id)} type="button">{location.name}</button>)}
        </div>
        {props.view.canManage ? <button className="device-wall-secondary" disabled={props.pending} onClick={props.save} type="button"><Icon name="drag" size={15} /> Save layout</button> : null}
      </div>
      {props.saveMessage ? <p className="device-wall-status" role="status">{props.saveMessage}</p> : null}
      {!props.view.policy.enabled ? <ModuleDisabled /> : null}
      {props.view.policy.enabled && props.devices.length === 0 ? <EmptyWall /> : null}
      {props.view.policy.enabled && props.devices.length > 0 ? <div className="device-wall-workspace">
        <div className="device-wall-list">
          {props.devices.map((device) => <DeviceCard canArrange={props.view.canManage} canConnect={props.view.canManage} installation={device} key={device.id} onConnect={() => props.onConnect(device.id)} onMove={(direction) => props.onMove(device.id, direction)} onSelect={() => props.onSelect(device.id)} selected={props.selectedId === device.id} />)}
        </div>
        {props.selected ? <aside>
          <DeviceStudio installation={props.selected} />
          <div className="device-wall-selected-actions">
            <button className="device-wall-secondary" disabled={!props.view.canDiagnose} onClick={() => setDrawerOpen(true)} type="button"><Icon name="activity" size={16} /> Diagnostics</button>
            <span><i data-status={props.selected.connectionState} />{props.selected.connectionState}</span>
          </div>
        </aside> : null}
      </div> : null}
      <DiagnosticsDrawer canStream={props.view.canStream} installation={props.selected} onOpenChange={setDrawerOpen} open={drawerOpen} />
    </section>
  );
}

function ModuleDisabled() {
  return <div className="device-wall-disabled"><Icon name="lock" /><div><strong>Module disabled for this tenant</strong><p>Enable a reviewed tenant declaration before registration or streaming.</p></div></div>;
}

function EmptyWall() {
  return <div className="device-wall-empty"><span className="device-card-silhouette device-card-silhouette--tablet" /><h3>No devices at this location</h3><p>Add a secure installation or launch Operator after staff sign-in.</p></div>;
}
