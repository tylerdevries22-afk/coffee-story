'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';

import {
  boardColumns, reconcileBoard,
  type BoardColumnView, type BoardConfig, type BoardEntry, type BoardSlot,
} from '@platform/domain';
import type { BoardTicketRow } from '@platform/schema';
import { formatCopy, type BrandCopy } from '@platform/ui/copy';

import { TIER_TONE_VARIABLE } from '@/lib/theme';

/** Past this without a successful read, the freshness line admits it may be stale. */
const STALE_AFTER_MS = 90_000;
/**
 * The reconcile interval.
 *
 * Deliberately a poll and not a Realtime subscription, which is the reverse of
 * what this file used to claim. `orders` is in the `supabase_realtime`
 * publication with `replica identity full`, so a socket on that table delivers
 * the *whole row* -- customer_id, totals, the note -- to whatever subscribed.
 * Since 0030 a display device has no read on `orders` at all, so it would
 * receive nothing anyway; and the version where it could receive something is
 * precisely the version that puts a cart snapshot in a browser sitting in a
 * public room. Five seconds of latency is the cheaper side of that trade.
 *
 * The poll goes to this app's own route, which holds the device token
 * server-side. The wall's browser never has a database credential.
 */
const RECONCILE_MS = 5_000;
/** How long a collected ticket lingers so a guest walking up still sees it. */
const LINGER_MS = 90_000;

export type BoardViewProps = {
  locationName: string;
  initialTickets: BoardTicketRow[];
  config: BoardConfig;
  copy: BrandCopy;
  /** Absent when the deployment has no database; the board then runs on fixtures. */
  live: boolean;
  /** True when the server's own read failed and this is a degraded board. */
  degraded: boolean;
};

type Freshness = 'live' | 'stale' | 'fixtures';

export function BoardView({
  locationName, initialTickets, config, copy, live, degraded,
}: BoardViewProps) {
  const [slots, setSlots] = useState<BoardSlot[]>(
    () => initialTickets.map((ticket) => ({ ticket, goneSince: null })),
  );
  const [lastRead, setLastRead] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // A clock, for the freshness line and for expiring lingering tickets. One
  // interval rather than two: they are the same question asked twice.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);

  // Nothing on a wall is watching for a failed fetch, so the board re-reads on
  // a timer and reports its own staleness rather than assuming it is current.
  //
  // This runs on fixtures too. The demo cycle moves, so polling it exercises
  // the reconcile and the linger for real -- which matters because this is a
  // React component in a repo with no component renderer, making the demo the
  // only place this loop is ever executed before a shop depends on it.
  useEffect(() => {
    let cancelled = false;
    const reconcile = async () => {
      try {
        const response = await fetch(`${window.location.pathname}/tickets`, {
          cache: 'no-store',
          headers: { accept: 'application/json' },
        });
        if (!response.ok) return;
        const next = (await response.json()) as BoardTicketRow[];
        if (cancelled || !mounted.current || !Array.isArray(next)) return;
        const at = Date.now();
        setSlots((previous) => reconcileBoard(previous, next, at, LINGER_MS));
        setLastRead(at);
      } catch {
        // Keep the last good board on screen. A dark screen is worse than a
        // slightly stale one, and the freshness line already says so.
      }
    };
    const id = setInterval(() => void reconcile(), RECONCILE_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // Lingering tickets have to leave even when no read arrives to push them
  // out -- otherwise a shop that loses its network keeps a collected number on
  // the board until somebody power-cycles the screen. Returning `previous`
  // unchanged when nothing expired is what stops this from re-rendering the
  // whole board once a second all day.
  useEffect(() => {
    setSlots((previous) => {
      const kept = previous.filter(
        (slot) => slot.goneSince === null || now - slot.goneSince < LINGER_MS,
      );
      return kept.length === previous.length ? previous : kept;
    });
  }, [now]);

  const columns = useMemo(() => boardColumns(slots, config), [slots, config]);

  // In fixtures mode nothing ever refreshes `lastRead`, so measuring staleness
  // against it would put "Reconnecting" on a demo board ninety seconds in and
  // leave it there -- announcing a failure of a connection that was never
  // supposed to exist. The three states are distinct on purpose.
  const freshness: Freshness = !live
    ? 'fixtures'
    : (now - lastRead > STALE_AFTER_MS || degraded ? 'stale' : 'live');

  // Always through formatCopy: it is the one accessor that falls back to the
  // key rather than to `undefined`, so a dictionary missing an entry shows a
  // visibly wrong word instead of a silently blank chip on a wall.
  const freshnessLabel = formatCopy(copy, {
    live: 'boardLive', stale: 'boardStale', fixtures: 'boardOffline',
  }[freshness]);

  return (
    <>
      <header className="board-header">
        <div className="board-heading">
          <h1 className="board-title">{formatCopy(copy, 'boardTitle')}</h1>
          {/* The location stays, demoted. A brand running two shops has two
              of these screens and no other way to tell them apart -- but the
              room is already standing in the location, so it is not the
              headline. */}
          {locationName ? <p className="board-place">{locationName}</p> : null}
        </div>
        <span className="board-freshness" data-freshness={freshness} aria-live="polite">
          <i className="board-freshness-dot" aria-hidden="true" />
          {freshnessLabel}
        </span>
      </header>
      <div className="board-columns">
        <Column
          title={formatCopy(copy, 'boardMakingNow')}
          column="progress"
          view={columns.inProgress}
          empty={formatCopy(copy, 'boardEmptyProgress')}
          copy={copy}
        />
        <Column
          title={formatCopy(copy, 'boardReady')}
          column="ready"
          view={columns.ready}
          empty={formatCopy(copy, 'boardEmptyReady')}
          copy={copy}
        />
      </div>
    </>
  );
}

function Column({
  title, column, view, empty, copy,
}: {
  title: string;
  column: 'progress' | 'ready';
  view: BoardColumnView;
  empty: string;
  copy: BrandCopy;
}) {
  return (
    <section className="board-column" data-column={column} aria-label={title}>
      <h2>{title}</h2>
      {view.entries.length === 0 ? (
        <p className="board-empty">{empty}</p>
      ) : (
        <ul className="ticket-list">
          {view.entries.map((entry) => (
            <Ticket key={entry.id} entry={entry} copy={copy} />
          ))}
        </ul>
      )}
      {view.overflow > 0 ? (
        <p className="board-overflow">
          {formatCopy(copy, 'boardOverflow', { count: view.overflow })}
        </p>
      ) : null}
    </section>
  );
}

function Ticket({ entry, copy }: { entry: BoardEntry; copy: BrandCopy }) {
  return (
    <li className="ticket" data-collected={entry.collected}>
      <span className="ticket-number">{entry.number}</span>
      <span className="ticket-who">
        {/* A blank name renders nothing rather than an empty line: a till
            operator skipping the name is routine, and holding the space open
            for it left the provenance hanging below a gap. */}
        {entry.name ? <span className="ticket-name">{entry.name}</span> : null}
        {entry.provenance ? (
          <span className="ticket-provenance">{entry.provenance}</span>
        ) : null}
      </span>
      <span className="ticket-marks">
        {entry.tier ? (
          <span
            className="ticket-tier"
            style={{ '--tier-tone': TIER_TONE_VARIABLE[entry.tier.tone] } as CSSProperties}
          >
            {entry.tier.label}
          </span>
        ) : null}
        {entry.arrived
          ? <span className="ticket-arrived">{formatCopy(copy, 'boardArrived')}</span>
          : null}
      </span>
    </li>
  );
}

export { STALE_AFTER_MS, RECONCILE_MS, LINGER_MS };
