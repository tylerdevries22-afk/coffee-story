'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { useMemo, useState, useTransition } from 'react';

import type { DeviceAppTarget, DeviceFormFactor, DeviceWallPolicy } from '@platform/device-wall';

import { enrollDeviceAction } from '@/lib/device-wall-actions';
import type { WorkspaceLocation } from '@/lib/workspace-scope';
import { Icon } from '@/components/icon';

export type AddedDevice = {
  id: string; label: string; locationId: string; formFactor: DeviceFormFactor; appTarget: DeviceAppTarget;
};

const FACTORS: readonly { value: DeviceFormFactor; label: string; note: string }[] = [
  { value: 'phone', label: 'Titanium phone', note: 'Handheld operator station' },
  { value: 'tablet', label: 'Studio tablet', note: 'Counter or kiosk station' },
  { value: 'tv', label: 'Gallery TV', note: 'Pickup queue wall display' },
];
const TARGETS: readonly { value: DeviceAppTarget; label: string; note: string }[] = [
  { value: 'operator', label: 'Operator', note: 'Registers automatically after staff sign-in' },
  { value: 'pickup_queue', label: 'Pickup Queue', note: 'Pairs with a one-time location code' },
  { value: 'kiosk_pos', label: 'Kiosk / POS', note: 'Pairs with a one-time location code' },
];

export function AddDeviceWizard(props: {
  readonly locations: readonly WorkspaceLocation[];
  readonly policy: DeviceWallPolicy;
  readonly disabled: boolean;
  readonly onAdded: (device: AddedDevice) => void;
}) {
  const firstLocation = props.locations[0]?.id ?? '';
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [locationId, setLocationId] = useState(firstLocation);
  const [label, setLabel] = useState('');
  const [formFactor, setFormFactor] = useState<DeviceFormFactor>('tablet');
  const [appTarget, setAppTarget] = useState<DeviceAppTarget>('operator');
  const [invite, setInvite] = useState<{ installationId: string; code: string; expiresAt: string } | null>(null);
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();
  const locationName = useMemo(() => props.locations.find((item) => item.id === locationId)?.name ?? 'Location', [locationId, props.locations]);
  const reset = () => { setStep(0); setLabel(''); setInvite(null); setError(''); };
  const changeOpen = (next: boolean) => { setOpen(next); if (!next) reset(); };
  const advance = () => {
    setError('');
    if (step === 0 && (!locationId || !label.trim())) { setError('Choose a location and name this device.'); return; }
    if (step !== 2 || appTarget === 'operator') { setStep((value) => Math.min(4, value + 1)); return; }
    startTransition(async () => {
      const result = await enrollDeviceAction({ locationId, label, formFactor, appTarget });
      if (!result.ok) { setError(result.error); return; }
      setInvite(result.data); setStep(3);
    });
  };
  const finish = () => {
    props.onAdded({ id: invite?.installationId ?? crypto.randomUUID(), label: label.trim(), locationId, formFactor, appTarget });
    changeOpen(false);
  };
  return (
    <Dialog.Root open={open} onOpenChange={changeOpen}>
      <Dialog.Trigger asChild><button className="device-wall-primary" type="button" disabled={props.disabled}><Icon name="plus" size={16} /> Add device</button></Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="device-wizard-overlay" />
        <Dialog.Content className="device-wizard" aria-describedby="device-wizard-description">
          <header><span className="device-wall-kicker">Step {step + 1} of 5</span><Dialog.Title>Add a device</Dialog.Title><Dialog.Description id="device-wizard-description">Securely place an application at one location.</Dialog.Description></header>
          <div className="device-wizard-progress" aria-hidden="true">{[0, 1, 2, 3, 4].map((item) => <i key={item} data-active={item <= step} />)}</div>
          <div className="device-wizard-body">
            {step === 0 ? <div className="device-wizard-fields"><label>Location<select value={locationId} onChange={(event) => setLocationId(event.target.value)}>{props.locations.map((location) => <option key={location.id} value={location.id}>{location.name} · {location.city}</option>)}</select></label><label>Device name<input maxLength={60} value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Prep tablet" autoFocus /></label></div> : null}
            {step === 1 ? <ChoiceGrid items={FACTORS.filter((item) => props.policy.formFactors.includes(item.value))} value={formFactor} onChange={setFormFactor} kind="factor" /> : null}
            {step === 2 ? <ChoiceGrid items={TARGETS.filter((item) => props.policy.appTargets.includes(item.value))} value={appTarget} onChange={setAppTarget} kind="app" /> : null}
            {step === 3 ? <PairingStep target={appTarget} invite={invite} locationName={locationName} /> : null}
            {step === 4 ? <div className="device-wizard-confirm"><span className={`device-card-silhouette device-card-silhouette--${formFactor}`} /><h3>{label}</h3><p>{locationName} · {TARGETS.find((item) => item.value === appTarget)?.label}</p><ul><li>Heartbeat and safe diagnostics</li><li>Private per-device signaling</li><li>Screen sharing only after visible OS consent</li></ul></div> : null}
            {error ? <p className="device-wizard-error" role="alert">{error}</p> : null}
          </div>
          <footer><Dialog.Close asChild><button className="device-wall-secondary" type="button">Cancel</button></Dialog.Close>{step > 0 && step < 4 ? <button className="device-wall-secondary" type="button" onClick={() => setStep((value) => value - 1)}>Back</button> : null}<button className="device-wall-primary" type="button" onClick={step === 4 ? finish : advance} disabled={pending}>{pending ? 'Creating…' : step === 4 ? 'Place on wall' : 'Continue'}</button></footer>
          <Dialog.Close className="device-wizard-close" aria-label="Close"><Icon name="close" /></Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ChoiceGrid<T extends string>(props: { readonly items: readonly { value: T; label: string; note: string }[]; readonly value: T; readonly onChange: (value: T) => void; readonly kind: 'factor' | 'app' }) {
  return <div className="device-wizard-choices">{props.items.map((item) => <button key={item.value} type="button" data-selected={props.value === item.value} onClick={() => props.onChange(item.value)}>{props.kind === 'factor' ? <span className={`device-choice-visual device-choice-visual--${item.value}`} /> : <Icon name={item.value === 'operator' ? 'activity' : 'kiosk'} size={22} />}<strong>{item.label}</strong><small>{item.note}</small></button>)}</div>;
}

function PairingStep(props: { readonly target: DeviceAppTarget; readonly invite: { code: string; expiresAt: string } | null; readonly locationName: string }) {
  if (props.target === 'operator') return <div className="device-pairing"><Icon name="activity" size={28} /><h3>Automatic registration</h3><p>Open Operator at {props.locationName} and sign in. This installation will register with its protected device identity on startup.</p></div>;
  return <div className="device-pairing"><span className="device-pairing-code">{props.invite?.code ?? '••••••••'}</span><h3>Pair at {props.locationName}</h3><p>Enter this single-use code on the device. It expires at {props.invite ? new Date(props.invite.expiresAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—'} and cannot be replayed.</p></div>;
}
