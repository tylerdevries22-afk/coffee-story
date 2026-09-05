'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { boardQueue, resolveBoardConfig, type BoardEntry } from '@platform/domain';

import type { WallPreviewTicket } from '@/lib/wall-preview';

const REFRESH_MS = 15_000;
const REQUEST_TIMEOUT_MS = 5_000;

function isTicketList(value: unknown): value is WallPreviewTicket[] {
  return Array.isArray(value);
}

async function fetchTickets(path: string): Promise<WallPreviewTicket[] | null> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(path, { cache: 'no-store', signal: controller.signal });
      if (!response.ok) {
        if (response.status >= 500 && attempt === 0) continue;
        return null;
      }
      const value: unknown = await response.json();
      return isTicketList(value) ? value : null;
    } catch {
      if (attempt === 1) return null;
    } finally {
      clearTimeout(timeout);
    }
  }
  return null;
}

function TicketRow({ entry }: { entry: BoardEntry }) {
  return (
    <li className={`wall-preview-ticket${entry.ready ? ' ready' : ''}`}>
      <span className="wall-preview-mark" aria-hidden="true">{entry.ready ? '✓' : entry.position}</span>
      <span className="wall-preview-ticket-copy">
        <strong>{entry.name || 'Update'}</strong>
        <small>{entry.ready ? 'Ready' : `Reference ${entry.callout}`}</small>
      </span>
      {entry.arrived ? <span className="pill success">Arrived</span> : null}
    </li>
  );
}

export function WallPreview({
  initialTickets,
  locationId,
  locationName,
}: {
  initialTickets: WallPreviewTicket[];
  locationId: string;
  locationName: string;
}) {
  const [tickets, setTickets] = useState<WallPreviewTicket[]>(initialTickets);
  const [degraded, setDegraded] = useState(false);
  const requestInFlight = useRef(false);
  const refresh = useCallback(async () => {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    const next = await fetchTickets(`/wall/preview/${encodeURIComponent(locationId)}/tickets`);
    requestInFlight.current = false;
    if (next) {
      setTickets(next);
      setDegraded(false);
    } else {
      setDegraded(true);
    }
  }, [locationId]);

  useEffect(() => {
    const interval = setInterval(() => { void refresh(); }, REFRESH_MS);
    const onVisibility = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refresh]);

  const queue = boardQueue(tickets, resolveBoardConfig(null));
  return (
    <main className="wall-preview" aria-label={`${locationName} location display`}>
      <header className="wall-preview-header">
        <div>
          <p className="wall-preview-kicker">{locationName}</p>
          <h1>Location status</h1>
        </div>
        <span className={`pill ${degraded ? 'warning' : 'success'}`} aria-live="polite">
          {degraded ? 'Reconnecting' : 'Live'}
        </span>
      </header>
      {queue.entries.length ? (
        <ol className="wall-preview-list">
          {queue.entries.map((entry) => <TicketRow entry={entry} key={entry.id} />)}
        </ol>
      ) : <p className="wall-preview-empty">No active updates at this location.</p>}
      {queue.overflow > 0 ? <p className="wall-preview-overflow">+{queue.overflow} more waiting</p> : null}
    </main>
  );
}
