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
    <section className="hq-panel hq-live-activity" aria-live="polite">
      <header className="hq-panel-header">
        <div><p className="hq-eyebrow">Preview runtime</p><h2>Five-surface order sync</h2></div>
        <span className="hq-status-badge"><span />Polling</span>
      </header>
      <div className="hq-live-activity-grid">
        <div><span>Shared orders</span><strong>{snapshot.orders.length}</strong></div>
        <div>
          <span>Latest ticket</span><strong>{latest?.shortCode ?? '—'}</strong>
          <small>{latest ? `${latest.guestName || 'Guest'} · ${latest.status.replace('_', ' ')}` : 'Place an order from Customer or Kiosk'}</small>
        </div>
      </div>
    </section>
  );
}
