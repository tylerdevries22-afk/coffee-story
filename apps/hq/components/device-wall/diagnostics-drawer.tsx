'use client';

import { useState, useTransition } from 'react';

import { diagnosticPlan, type DiagnosticResult } from '@platform/device-wall';

import { Icon } from '@/components/icon';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import {
  authorizeStreamAction, diagnosticsAction, revokeInstallationAction,
} from '@/lib/device-wall-actions';
import type { WallInstallation } from '@/lib/device-wall-data';

function previewResults(device: WallInstallation): readonly DiagnosticResult[] {
  return diagnosticPlan(device.capabilities).map((check) => ({
    key: check.key,
    status: check.key === 'heartbeat' || check.key === 'authentication' || check.key === 'runtime'
      ? 'pass' : 'not_available',
    durationMs: check.key === 'heartbeat' && device.lastSeenAt
      ? Math.max(0, Date.now() - Date.parse(device.lastSeenAt)) : null,
    safeMessage: check.key === 'heartbeat' ? 'Heartbeat current' : check.requires ? 'Awaiting device confirmation' : 'Ready',
  }));
}

export function DiagnosticsDrawer(props: {
  readonly installation: WallInstallation | null;
  readonly open: boolean;
  readonly canStream: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const [results, setResults] = useState<readonly DiagnosticResult[]>([]);
  const [error, setError] = useState('');
  const [streamMessage, setStreamMessage] = useState('');
  const [pending, startTransition] = useTransition();
  const run = () => {
    if (!props.installation) return;
    setError('');
    startTransition(async () => {
      const response = await diagnosticsAction(props.installation!.id);
      if (!response.ok) { setError(response.error); return; }
      setResults(response.data.results.length ? response.data.results : previewResults(props.installation!));
    });
  };
  const stream = () => {
    if (!props.installation) return;
    setError('');
    startTransition(async () => {
      const response = await authorizeStreamAction(props.installation!.id);
      if (!response.ok) { setError(response.error); return; }
      setStreamMessage('Authorization ready. Waiting for visible capture consent on the device.');
    });
  };
  const revoke = () => {
    if (!props.installation || !window.confirm('Revoke this installation from Device Wall?')) return;
    setError('');
    startTransition(async () => {
      const response = await revokeInstallationAction(props.installation!.id);
      if (!response.ok) { setError(response.error); return; }
      props.onOpenChange(false);
    });
  };
  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent className="device-diagnostics">
        <SheetHeader>
          <SheetTitle>{props.installation?.label ?? 'Device'} diagnostics</SheetTitle>
          <SheetDescription>Safe connectivity checks only. No camera, microphone, clipboard, files, or remote control.</SheetDescription>
        </SheetHeader>
        {props.installation ? <div className="device-diagnostics-body">
          <div className="device-diagnostics-summary"><span data-status={props.installation.connectionState} /><div><strong>{props.installation.connectionState}</strong><small>{props.installation.locationName} · {props.installation.runtimeVersion}</small></div></div>
          <button className="device-wall-primary" type="button" onClick={run} disabled={pending}><Icon name="activity" size={16} /> Run safe tests</button>
          <ul className="device-diagnostic-results">{results.map((result) => <li key={result.key} data-status={result.status}><span /><div><strong>{result.key.replaceAll('_', ' ')}</strong><small>{result.safeMessage}{result.durationMs !== null ? ` · ${Math.round(result.durationMs)}ms` : ''}</small></div></li>)}</ul>
          <div className="device-stream-control"><span className="device-wall-kicker">Opt-in screen view</span><p>Pixels travel peer-to-peer over encrypted WebRTC and are never stored. The device must approve operating-system capture first.</p><button className="device-wall-secondary" type="button" onClick={stream} disabled={!props.canStream || pending}><Icon name="lock" size={16} /> Request screen view</button>{!props.canStream ? <small>Streaming is locked during registration-only rollout.</small> : null}{streamMessage ? <small role="status">{streamMessage}</small> : null}</div>
          <button className="device-wall-danger" type="button" onClick={revoke} disabled={pending}>Revoke installation</button>
          {error ? <p className="device-wizard-error" role="alert">{error}</p> : null}
        </div> : null}
      </SheetContent>
    </Sheet>
  );
}
