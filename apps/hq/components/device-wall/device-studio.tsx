'use client';

import dynamic from 'next/dynamic';

import type { WallInstallation } from '@/lib/device-wall-data';

const DeviceTwin = dynamic(
  () => import('@platform/device-twin').then((module) => module.DeviceTwin),
  { ssr: false, loading: () => <div className="device-studio-loading" aria-label="Loading device twin" /> },
);

export function DeviceStudio({ installation }: { readonly installation: WallInstallation }) {
  return (
    <div className="device-studio" aria-label={`${installation.label} premium device twin`}>
      <div className="device-studio-copy">
        <span className="device-wall-kicker">Selected twin</span>
        <strong>{installation.label}</strong>
        <small>{installation.locationName} · {installation.appTarget.replace('_', ' ')}</small>
      </div>
      <DeviceTwin
        formFactor={installation.formFactor}
        label={installation.label}
        phoneAssetUrl="/models/device-wall/iphone15-pro-max.glb"
        status={installation.connectionState}
      />
      <span className="device-studio-lock">Locked view · drag disabled</span>
    </div>
  );
}
