'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function ConnectorDisconnectButton({ provider }: { readonly provider: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  async function disconnect(): Promise<void> {
    if (!window.confirm('Disconnect this provider from this brand?')) return;
    setPending(true);
    setError('');
    try {
      const response = await fetch(`/api/connectors/${encodeURIComponent(provider)}/authorize`, {
        method: 'DELETE',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error('disconnect failed');
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
        {pending ? 'Disconnecting…' : 'Disconnect provider'}
      </button>
      {error ? <p className="notice" role="alert">{error}</p> : null}
    </div>
  );
}
