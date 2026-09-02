'use client';

import { useEffect, useState } from 'react';

export type SyncState = 'checking' | 'live' | 'offline' | 'hosted';

const SYNC_LABEL: Readonly<Record<SyncState, string>> = {
  checking: 'Verifying local order broker…',
  live: 'Order broker live · pickup display synchronized',
  offline: 'Order broker unavailable',
  hosted: 'Hosted surfaces use their configured data plane',
};

/** Probes the local order broker once, with a bounded retry, so the wall can say whether its previews share data. */
export function usePreviewSync(): { readonly state: SyncState; readonly label: string } {
  const [state, setState] = useState<SyncState>('checking');
  useEffect(() => {
    if (!['localhost', '127.0.0.1'].includes(window.location.hostname)) { setState('hosted'); return undefined; }
    let cancelled = false;
    const check = async () => {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 3_000);
        try {
          const response = await fetch('/api/demo-sync/orders', { cache: 'no-store', signal: controller.signal });
          if (response.ok && Array.isArray((await response.json() as { orders?: unknown }).orders)) { if (!cancelled) setState('live'); return; }
        } catch { /* A bounded retry keeps the preview responsive while the broker starts. */ }
        finally { window.clearTimeout(timeout); }
      }
      if (!cancelled) setState('offline');
    };
    void check();
    return () => { cancelled = true; };
  }, []);
  return { state, label: SYNC_LABEL[state] };
}
