'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { fetchWithRetry, startSerializedPolling } from '@platform/api-client';
import { boardQueue, type BoardConfig } from '@platform/domain';
import type { BoardTicketRow } from '@platform/schema';

import { boardFreshness } from '@/lib/board-freshness';

/** Past this without a successful read, the freshness line admits it may be stale. */
export const STALE_AFTER_MS = 90_000;
/**
 * Realtime is the fast path. This heartbeat recovers from a dropped socket,
 * suspended browser, or missed notification.
 */
export const RECONCILE_MS = 60_000;
export const DEMO_SYNC_RECONCILE_MS = 1_000;
const TICKET_READ_TIMEOUT_MS = 5_000;
const PRESENCE_INTERVAL_MS = 30_000;
// A hung beat is abandoned before the next one is due, so the queue cannot grow.
const PRESENCE_TIMEOUT_MS = 10_000;

type BoardQueueOptions = {
  initialTickets: BoardTicketRow[];
  config: BoardConfig;
  live: boolean;
  degraded: boolean;
  demoSynced: boolean;
};

export function useBoardQueue({
  initialTickets,
  config,
  live,
  degraded,
  demoSynced,
}: BoardQueueOptions) {
  const [tickets, setTickets] = useState<BoardTicketRow[]>(initialTickets);
  const [lastRead, setLastRead] = useState(() => Date.now());
  const [readDegraded, setReadDegraded] = useState(degraded);
  const [now, setNow] = useState(() => Date.now());
  const mounted = useRef(true);
  const reconcileInFlight = useRef<Promise<void> | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // A clock, for the freshness line only.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(id);
  }, []);

  const reconcile = useCallback(async () => {
    if (reconcileInFlight.current) return reconcileInFlight.current;
    const request = (async () => {
      try {
        const response = await fetchWithRetry(`${window.location.pathname}/tickets`, {
          cache: 'no-store',
          headers: { accept: 'application/json' },
        }, TICKET_READ_TIMEOUT_MS, 2);
        if (!response.ok) {
          if (mounted.current) setReadDegraded(true);
          return;
        }
        const next = (await response.json()) as BoardTicketRow[];
        if (!mounted.current || !Array.isArray(next)) return;
        // Replace outright so a collected ticket leaves the board immediately.
        setTickets(next);
        setLastRead(Date.now());
        setReadDegraded(false);
      } catch {
        if (mounted.current) setReadDegraded(true);
      }
    })();
    reconcileInFlight.current = request;
    try {
      await request;
    } finally {
      if (reconcileInFlight.current === request) reconcileInFlight.current = null;
    }
  }, []);

  // EventSource carries only an invalidation; the browser reconciles separately.
  useEffect(() => {
    if (!live) return undefined;
    const events = new EventSource(`${window.location.pathname}/events`);
    events.onmessage = (event) => {
      if (event.data !== 'heartbeat') void reconcile();
    };
    return () => events.close();
  }, [live, reconcile]);

  // Polling also exercises the fixture-backed demo path.
  useEffect(() => {
    return startSerializedPolling(
      reconcile,
      demoSynced ? DEMO_SYNC_RECONCILE_MS : RECONCILE_MS,
    );
  }, [demoSynced, reconcile]);

  useEffect(() => {
    if (!live) return undefined;
    const heartbeat = () => {
      const abort = new AbortController();
      const deadline = setTimeout(() => abort.abort(), PRESENCE_TIMEOUT_MS);
      void fetch(`${window.location.pathname}/presence`, {
        method: 'POST', cache: 'no-store', keepalive: true, signal: abort.signal,
      }).catch(() => undefined).finally(() => clearTimeout(deadline));
    };
    heartbeat();
    const id = setInterval(heartbeat, PRESENCE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [live]);

  const queue = useMemo(() => boardQueue(tickets, config), [tickets, config]);
  // Fixtures have no database read to become stale; their state stays distinct.
  const freshness = boardFreshness(live, readDegraded, lastRead, now, STALE_AFTER_MS);

  return { queue, freshness };
}
