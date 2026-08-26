'use client';

import { useEffect, useState } from 'react';

import { fetchWithRetry, startSerializedPolling, type DemoSyncSnapshot } from '@platform/api-client';

export function DemoLiveActivity() {
  const [snapshot, setSnapshot] = useState<DemoSyncSnapshot | null>(null);

  useEffect(() => {
    let active = true;
    const stop = startSerializedPolling(async () => {
      const response = await fetchWithRetry('/api/demo-sync/orders', {
        method: 'GET', headers: { accept: 'application/json' },
      }, 3_000, 2);
      if (!response.ok) return;
      const next = await response.json() as DemoSyncSnapshot;
      if (active) setSnapshot(next);
    }, 1_000);
    return () => { active = false; stop(); };
  }, []);

  if (!snapshot) return null;
  const latest = snapshot.orders.at(-1);
  return (
    <div className="card" aria-live="polite">
      <h2>Live five-surface demo</h2>
      <div className="kpi-row">
        <div className="kpi-card">
          <div className="label">Shared orders</div>
          <div className="value">{snapshot.orders.length}</div>
        </div>
        <div className="kpi-card">
          <div className="label">Latest ticket</div>
          <div className="value">{latest?.shortCode ?? '—'}</div>
          <div className="hint">{latest ? `${latest.guestName || 'Guest'} · ${latest.status.replace('_', ' ')}` : 'Place an order from Customer or Kiosk'}</div>
        </div>
      </div>
    </div>
  );
}
