'use client';

import { useMemo, useState, useTransition } from 'react';

import type { DeviceFormFactor } from '@platform/device-wall';

import { AppsPreviewTable } from '@/components/apps-preview-table';
import { AppsPreviewMosaic } from '@/components/apps-preview-mosaic';
import { AppsViewTabs } from '@/components/apps-view-tabs';
import type { AppPreview } from '@/lib/app-previews';
import { saveDeviceLayoutAction } from '@/lib/device-wall-actions';
import type { DeviceWallView, WallInstallation } from '@/lib/device-wall-data';
import { resetWallLayoutPreference } from '@/components/use-wall-layout';

import type { AddedDevice } from './add-device-wizard';
import { DeviceConnectionWizard } from './device-connection-wizard';

function ordered(view: DeviceWallView) {
  const positions = new Map(view.layout.map((item) => [item.installationId, item.x]));
  return [...view.installations].sort((a, b) => (positions.get(a.id) ?? 10_000) - (positions.get(b.id) ?? 10_000));
}

function provisional(view: DeviceWallView, added: AddedDevice): WallInstallation {
  return {
    id: added.id, brandId: view.brandId, locationId: added.locationId,
    locationName: view.locations.find((item) => item.id === added.locationId)?.name ?? 'Location',
    installedBy: null, label: added.label, formFactor: added.formFactor, appTarget: added.appTarget,
    platform: 'web', appVersion: 'pending', runtimeVersion: 'pending', capabilities: ['heartbeat'],
    lastSeenAt: null, archivedAt: null, connectionState: 'provisioning',
  };
}

function orientation(formFactor: DeviceFormFactor) {
  return formFactor === 'phone' ? 'portrait' as const : 'landscape' as const;
}

export function DeviceWallModule({ previews, view }: { readonly previews: readonly AppPreview[]; readonly view: DeviceWallView }) {
  const initial = useMemo(() => ordered(view), [view]);
  const [devices, setDevices] = useState(initial);
  const [locationId, setLocationId] = useState(view.selectedLocationId ?? 'all');
  const [selectedId, setSelectedId] = useState(initial[0]?.id ?? '');
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState('');
  const [pending, startTransition] = useTransition();
  const visible = useMemo(
    () => devices.filter((device) => locationId === 'all' || device.locationId === locationId),
    [devices, locationId],
  );
  const selected = visible.find((device) => device.id === selectedId) ?? visible[0] ?? null;
  const effectiveSelectedId = selected?.id ?? '';
  const connectionDevice = devices.find((device) => device.id === connectionId) ?? null;
  const add = (added: AddedDevice) => {
    const device = provisional(view, added);
    setDevices((current) => [...current, device]);
    setSelectedId(device.id);
  };
  const move = (id: string, direction: -1 | 1) => setDevices((current) => {
    const index = current.findIndex((item) => item.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= current.length) return current;
    const next = [...current];
    [next[index], next[target]] = [next[target]!, next[index]!];
    return next;
  });
  const reset = () => {
    resetWallLayoutPreference();
    setDevices(initial);
    setLocationId(view.selectedLocationId ?? 'all');
    setSelectedId(initial[0]?.id ?? '');
    setSaveMessage('Layout reset for this visit.');
  };
  const save = () => startTransition(async () => {
    const layout = devices.map((device, index) => ({
      installationId: device.id, x: index, y: 0, width: 280, orientation: orientation(device.formFactor),
    }));
    const result = await saveDeviceLayoutAction(locationId === 'all' ? null : locationId, layout);
    setSaveMessage(result.ok ? 'Personal layout saved.' : result.error ?? 'The layout could not be saved.');
  });
  const controls = {
    devices: visible, onAdd: add, onConnect: setConnectionId, onLocationChange: setLocationId,
    onMove: move, onSelect: setSelectedId, selected, selectedId: effectiveSelectedId, save, saveMessage,
    locationId, pending, view,
  };
  return (
    <>
      <AppsViewTabs
        onReset={reset}
        table={<AppsPreviewTable {...controls} />}
        wall={<AppsPreviewMosaic previews={previews} />}
      />
      <DeviceConnectionWizard
        canStream={view.canStream}
        configured={view.configured}
        installation={connectionDevice}
        onOpenChange={(open) => { if (!open) setConnectionId(null); }}
        policy={view.policy}
      />
    </>
  );
}
