'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { fetchWithRetry, startSerializedPolling } from '@platform/api-client';
import { activityInitials, type ActivityBoardConfig } from '@platform/domain';
import type { ActivityBoardItemRow } from '@platform/schema';
import { boardFreshness } from '@/lib/board-freshness';

const STALE_AFTER_MS = 90_000;
const LIVE_RECONCILE_MS = 60_000;
const DEMO_RECONCILE_MS = 6_000;

const STATUS_LABEL = {
  scheduled: 'Queued', claimed: 'In progress', completed: 'Completed',
} as const;

export function ActivityBoardView({
  initialItems, config, locationName, live, degraded,
}: {
  initialItems: ActivityBoardItemRow[];
  config: ActivityBoardConfig;
  locationName: string;
  live: boolean;
  degraded: boolean;
}) {
  const [items, setItems] = useState(initialItems);
  const [lastRead, setLastRead] = useState(() => Date.now());
  const [readDegraded, setReadDegraded] = useState(degraded);
  const [now, setNow] = useState(() => Date.now());
  const inFlight = useRef<Promise<void> | null>(null);
  const mounted = useRef(true);

  useEffect(() => () => { mounted.current = false; }, []);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(timer);
  }, []);

  const reconcile = useCallback(async () => {
    if (inFlight.current) return inFlight.current;
    const request = (async () => {
      try {
        const response = await fetchWithRetry(`${window.location.pathname}/activity`, {
          cache: 'no-store', headers: { accept: 'application/json' },
        }, 5_000, 2);
        if (!response.ok) throw new Error('activity_unavailable');
        const next: unknown = await response.json();
        if (!mounted.current || !Array.isArray(next)) return;
        setItems(next as ActivityBoardItemRow[]);
        setLastRead(Date.now());
        setReadDegraded(false);
      } catch {
        if (mounted.current) setReadDegraded(true);
      }
    })();
    inFlight.current = request;
    try { await request; } finally {
      if (inFlight.current === request) inFlight.current = null;
    }
  }, []);

  useEffect(() => {
    if (!live) return undefined;
    const events = new EventSource(`${window.location.pathname}/events`);
    events.onmessage = (event) => { if (event.data !== 'heartbeat') void reconcile(); };
    return () => events.close();
  }, [live, reconcile]);
  useEffect(() => startSerializedPolling(
    reconcile, live ? LIVE_RECONCILE_MS : DEMO_RECONCILE_MS,
  ), [live, reconcile]);

  const visible = useMemo(() => [...items]
    .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))
    .slice(0, config.maxItems), [config.maxItems, items]);
  const freshness = boardFreshness(live, readDegraded, lastRead, now, STALE_AFTER_MS);
  const liveLabel = freshness === 'live' ? 'Live' : freshness === 'stale' ? 'Reconnecting' : 'Preview';

  return (
    <>
      <header className="board-header activity-header">
        <div>
          <p className="activity-location">{locationName}</p>
          <h1 className="board-title">{config.title}</h1>
        </div>
        <span className="board-freshness" data-freshness={freshness} aria-live="polite">
          <i className="board-freshness-dot" aria-hidden="true" />{liveLabel}
        </span>
      </header>
      <main className="activity-feed" aria-live="polite">
        {visible.map((item, index) => (
          <article className="activity-item" data-status={item.status}
            key={`${item.id}:${item.updated_at}`}
            style={{ '--activity-index': index } as CSSProperties}>
            {config.showAvatars ? (
              <span className="activity-avatar" aria-hidden="true">
                {activityInitials(item.actor_name ?? item.audience_labels[0] ?? 'Field team')}
              </span>
            ) : null}
            <span className="activity-copy">
              <span className="activity-role">{item.audience_labels.join(' · ') || 'Field team'}</span>
              <strong>{item.title}</strong>
              <small>{item.actor_name ?? 'Unassigned'}</small>
            </span>
            <span className="activity-status"><i aria-hidden="true" />{STATUS_LABEL[item.status]}</span>
          </article>
        ))}
        {visible.length === 0 ? <p className="board-empty">No project activity yet.</p> : null}
      </main>
    </>
  );
}
