'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import type { BoardTicketRow } from '@platform/schema';

/** Past this, the freshness line admits it may be stale. */
const STALE_AFTER_MS = 90_000;
/** A full re-read, regardless of what Realtime did or did not deliver. */
const RECONCILE_MS = 60_000;
/** How long a collected ticket lingers so a guest walking up still sees it. */
const LINGER_MS = 90_000;

export type BoardViewProps = {
  locationName: string;
  initialTickets: BoardTicketRow[];
  /** Absent when the deployment has no database; the board then runs on fixtures. */
  live: boolean;
};

function splitColumns(tickets: readonly BoardTicketRow[]) {
  return {
    inProgress: tickets.filter((t) => t.status === 'paid' || t.status === 'in_progress'),
    ready: tickets.filter((t) => t.status === 'ready'),
  };
}

export function BoardView({ locationName, initialTickets, live }: BoardViewProps) {
  const [tickets, setTickets] = useState(initialTickets);
  const [updatedAt, setUpdatedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const mounted = useRef(true);

  useEffect(() => () => { mounted.current = false; }, []);

  // A clock only for the freshness line. Cheap, and it is what lets the board
  // admit staleness instead of quietly showing an hour-old queue.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(id);
  }, []);

  // Reconcile on a timer whatever Realtime is doing. A dropped socket on a
  // wall-mounted tablet is invisible -- nobody is watching for a reconnect
  // toast -- so the board re-reads rather than trusting the stream.
  useEffect(() => {
    if (!live) return;
    let cancelled = false;
    const reconcile = async () => {
      try {
        const response = await fetch(`${window.location.pathname}/tickets`, { cache: 'no-store' });
        if (!response.ok) return;
        const next = (await response.json()) as BoardTicketRow[];
        if (!cancelled && mounted.current) {
          setTickets(next);
          setUpdatedAt(Date.now());
        }
      } catch {
        // Keep the last good board on screen. A dark screen is worse than a
        // slightly stale one, and the freshness line already says so.
      }
    };
    const id = setInterval(() => void reconcile(), RECONCILE_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [live]);

  const columns = useMemo(() => splitColumns(tickets), [tickets]);
  const stale = now - updatedAt > STALE_AFTER_MS;

  return (
    <>
      <header className="board-header">
        <h1 className="board-title">{locationName}</h1>
        <span className="board-freshness" data-stale={stale} aria-live="polite">
          {stale ? 'Reconnecting…' : 'Live'}
        </span>
      </header>
      <div className="board-columns">
        <Column title="Making now" column="progress" tickets={columns.inProgress} empty="Nothing in the queue." />
        <Column title="Ready" column="ready" tickets={columns.ready} empty="Nothing waiting." />
      </div>
    </>
  );
}

function Column({
  title, column, tickets, empty,
}: {
  title: string;
  column: 'progress' | 'ready';
  tickets: readonly BoardTicketRow[];
  empty: string;
}) {
  return (
    <section className="board-column" data-column={column} aria-label={title}>
      <h2>{title}</h2>
      {tickets.length === 0 ? (
        <p className="board-empty">{empty}</p>
      ) : (
        <ul className="ticket-list">
          {tickets.map((ticket) => (
            <li className="ticket" key={ticket.id}>
              <span className="ticket-number">{ticket.daily_number ?? '—'}</span>
              <span className="ticket-name">{ticket.guest_label ?? ''}</span>
              {ticket.arrived_at ? <span className="ticket-arrived">Here</span> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export { splitColumns, STALE_AFTER_MS, RECONCILE_MS, LINGER_MS };
