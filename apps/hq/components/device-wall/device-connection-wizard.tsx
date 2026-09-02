'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useMemo, useState, useTransition } from 'react';

import type { DeviceWallPolicy } from '@platform/device-wall';

import { Icon } from '@/components/icon';
import { deviceConnectionFlow } from '@/lib/device-connection-flow';
import { authorizeStreamAction, diagnosticsAction } from '@/lib/device-wall-actions';
import type { WallInstallation } from '@/lib/device-wall-data';

export function DeviceConnectionWizard(props: {
  readonly canStream: boolean;
  readonly configured: boolean;
  readonly installation: WallInstallation | null;
  readonly onOpenChange: (open: boolean) => void;
  readonly policy: DeviceWallPolicy;
}) {
  const [message, setMessage] = useState('');
  const [pending, startTransition] = useTransition();
  const installation = props.installation;
  const flow = useMemo(
    () => installation && deviceConnectionFlow(installation, props.policy, props.canStream),
    [installation, props.canStream, props.policy],
  );
  useEffect(() => { setMessage(''); }, [installation?.id]);
  const connect = () => {
    if (!installation || !flow || flow.action === 'none') return;
    setMessage('');
    startTransition(async () => {
      if (flow.action === 'diagnose') {
        const response = await diagnosticsAction(installation.id);
        if (!response.ok) { setMessage(response.error); return; }
        const passed = response.data.results.filter((result) => result.status === 'pass').length;
        setMessage(props.configured
          ? `Connection check complete: ${passed} safe checks passed.`
          : 'Connection readiness preview complete. Configure production services before sending device requests.');
        return;
      }
      const response = await authorizeStreamAction(installation.id);
      setMessage(response.ok
        ? 'Secure connection requested. The device user must approve visible operating-system capture before screen sharing begins.'
        : response.error);
    });
  };
  return (
    <Dialog.Root open={installation !== null} onOpenChange={props.onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="device-wizard-overlay" />
        <Dialog.Content aria-describedby="device-connection-description" className="device-wizard device-connection-wizard">
          <header>
            <span className="device-wall-kicker">Secure device connection</span>
            <Dialog.Title>Connect {installation?.label ?? 'device'}</Dialog.Title>
            <Dialog.Description id="device-connection-description">One protected flow for app readiness and opt-in screen sharing. It never enables remote control.</Dialog.Description>
          </header>
          {installation && flow ? <>
            <div className="device-connection-summary" data-status={installation.connectionState}>
              <span aria-hidden="true" className={`device-card-silhouette device-card-silhouette--${installation.formFactor}`} />
              <div><strong>{installation.label}</strong><span>{installation.locationName} · {installation.appTarget.replaceAll('_', ' ')}</span><small>{installation.platform} · v{installation.appVersion} · {installation.connectionState}</small></div>
            </div>
            <div className="device-connection-guidance" data-stream-eligible={flow.streamEligible}>
              <strong>{flow.heading}</strong><p>{flow.description}</p><p>{flow.guidance}</p>
            </div>
          </> : null}
          {message ? <p className="device-connection-message" role="status">{message}</p> : null}
          <footer>
            <Dialog.Close asChild><button className="device-wall-secondary" type="button">Close</button></Dialog.Close>
            {flow && flow.action !== 'none' ? <button className="device-wall-primary" disabled={pending} onClick={connect} type="button"><Icon name={flow.action === 'request_stream' ? 'lock' : 'activity'} size={16} /> {pending ? 'Checking…' : flow.actionLabel}</button> : null}
          </footer>
          <Dialog.Close aria-label="Close" className="device-wizard-close"><Icon name="close" /></Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
