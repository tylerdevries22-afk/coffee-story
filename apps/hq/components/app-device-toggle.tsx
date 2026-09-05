'use client';

import { APP_PREVIEW_DEVICES, type AppPreviewDevice } from '@/lib/app-previews';

import { Icon, type IconName } from './icon';

const DEVICE_META: Readonly<Record<AppPreviewDevice, { readonly icon: IconName; readonly label: string }>> = {
  desktop: { icon: 'desktop', label: 'Desktop' },
  tablet: { icon: 'tablet', label: 'Tablet' },
  mobile: { icon: 'mobile', label: 'Mobile' },
};

export function AppDeviceToggle({ app, value, onChange }: {
  readonly app: string;
  readonly value: AppPreviewDevice;
  readonly onChange: (device: AppPreviewDevice) => void;
}) {
  return (
    <span aria-label={`${app} preview device`} className="apps-device-toggle" role="group">
      {APP_PREVIEW_DEVICES.map((device) => {
        const meta = DEVICE_META[device];
        return (
          <button
            aria-label={`${app}: ${meta.label}`}
            aria-pressed={value === device}
            key={device}
            onClick={() => onChange(device)}
            title={meta.label}
            type="button"
          >
            <Icon name={meta.icon} size={13} />
          </button>
        );
      })}
    </span>
  );
}
