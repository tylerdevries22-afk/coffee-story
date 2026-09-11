'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { requestConnectorDisconnect } from '@/lib/connector-disconnect-request';

export function ConnectorDisconnectButton({ provider }: { readonly provider: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  async function disconnect(): Promise<void> {
    if (!window.confirm('Disconnect this provider from Coffee Story?')) return;
    setPending(true);
    setError('');
    try {
      await requestConnectorDisconnect(provider);
      router.refresh();
    } catch {
      setError('The connection could not be removed. Try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <button className="button danger" disabled={pending} onClick={disconnect} type="button">
        {pending ? 'Disconnecting…' : 'Disconnect from Coffee Story'}
      </button>
      {error ? <p className="notice" role="alert">{error}</p> : null}
    </div>
  );
}
