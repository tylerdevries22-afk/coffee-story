'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';

import { boardQueue, type BoardConfig, type BoardEntry } from '@platform/domain';
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
 * Five seconds is also the sync budget against `apps/operator`: a barista taps
 * "Ready" and the check appears here within one interval. The transition
 * itself is not this app's to make -- the operator writes an `order_events`
 * row, the trigger projects it onto `orders.status`, and this board reads the
 * result through `board_tickets`. One writer, one projection, one read.
 */
const RECONCILE_MS = 5_000;

export type BoardViewProps = {
  initialTickets: BoardTicketRow[];
  config: BoardConfig;
  copy: BrandCopy;
  /** Absent when the deployment has no database; the board then runs on fixtures. */
  live: boolean;
  /** True when the server's own read failed and this is a degraded board. */
  degraded: boolean;
};

type Freshness = 'live' | 'stale' | 'fixtures';

export function BoardView({ initialTickets, config, copy, live, degraded }: BoardViewProps) {
  const [tickets, setTickets] = useState<BoardTicketRow[]>(initialTickets);
  const [lastRead, setLastRead] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // A clock, for the freshness line only.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(id);
  }, []);

  // Nothing on a wall is watching for a failed fetch, so the board re-reads on
  // a timer and reports its own staleness rather than assuming it is current.
  //
  // This runs on fixtures too. The demo cycle moves, so polling it exercises
  // the whole path for real -- which matters because this is a React component
  // in a repo with no component renderer, making the demo the only place this
  // loop is ever executed before a shop depends on it.
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
        // Replace outright. A ticket that has left the read has been collected
        // -- the guest has their order in hand -- and holding it on screen
        // would leave a stranger's name up after they walked out.
        setTickets(next);
        setLastRead(Date.now());
      } catch {
        // Keep the last good board on screen. A dark screen is worse than a
        // slightly stale one, and the freshness line already says so.
      }
    };
    const id = setInterval(() => void reconcile(), RECONCILE_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const queue = useMemo(() => boardQueue(tickets, config), [tickets, config]);

  // In fixtures mode nothing ever refreshes `lastRead` against a database, so
  // measuring staleness against it would put "Reconnecting" on a demo board
  // and leave it there -- announcing a failure of a connection that was never
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
        <h1 className="board-title">{formatCopy(copy, 'boardTitle')}</h1>
        <span className="board-freshness" data-freshness={freshness} aria-live="polite">
          <i className="board-freshness-dot" aria-hidden="true" />
          {freshnessLabel}
        </span>
      </header>

      <ol className="ticket-list" aria-label={formatCopy(copy, 'boardTitle')}>
        {queue.entries.map((entry) => (
          <Ticket key={entry.id} entry={entry} copy={copy} />
        ))}
      </ol>

      {queue.entries.length === 0 ? (
        <p className="board-empty">{formatCopy(copy, 'boardEmpty')}</p>
      ) : null}

      {queue.overflow > 0 ? (
        <p className="board-overflow">
          {formatCopy(copy, 'boardOverflow', { count: queue.overflow })}
        </p>
      ) : null}
    </>
  );
}

/**
 * The mark at the head of a row: a place in line, or a check.
 *
 * Both are mounted at once and swapped with a transition rather than a
 * keyframe animation. A CSS transition settles at its end state; a keyframe
 * animation holds its *start* state for as long as it is paused, and a browser
 * pauses animations in a backgrounded tab -- which is how "Here" managed to be
 * invisible. The resting state of a check is therefore declared, not animated.
 */
function QueueMark({ entry, copy }: { entry: BoardEntry; copy: BrandCopy }) {
  return (
    <span
      className="ticket-mark"
      data-ready={entry.ready}
      role="img"
      aria-label={entry.ready
        ? formatCopy(copy, 'boardReady')
        : formatCopy(copy, 'boardPosition', { position: entry.position ?? 0 })}
    >
      <span className="ticket-position" aria-hidden="true">{entry.position ?? ''}</span>
      <svg className="ticket-check" viewBox="0 0 24 24" aria-hidden="true">
        <circle className="ticket-check-ring" cx="12" cy="12" r="10.5" />
        <path className="ticket-check-tick" d="M6.8 12.4l3.4 3.4 6.9-7.3" />
      </svg>
    </span>
  );
}

/**
 * The status badge.
 *
 * The mark leads, then the label -- a rung is recognised by its mark before
 * anyone has read a word of it, which is the whole reason a ladder has marks.
 *
 * Colour comes from the tier when the brand set one and from the tier's
 * semantic token role when it did not, so a brand gets four distinguishable
 * rungs if it wants them and a coherent default if it does not. The fill is a
 * wash and the type stays ink: at fifteen feet, dark-on-tint holds and
 * light-on-saturated does not, whatever colour a tenant picks.
 */
function TierBadge({ tier, copy }: { tier: NonNullable<BoardEntry['tier']>; copy: BrandCopy }) {
  return (
    <span
      className="ticket-tier"
      style={{
        '--tier-tone': tier.color ?? TIER_TONE_VARIABLE[tier.tone],
      } as CSSProperties}
    >
      <i className="ticket-tier-mark" aria-hidden="true">
        {tier.icon ?? formatCopy(copy, 'rewardMark')}
      </i>
      {formatCopy(copy, 'boardTierBadge', { tier: tier.label })}
    </span>
  );
}

function Ticket({ entry, copy }: { entry: BoardEntry; copy: BrandCopy }) {
  return (
    <li className="ticket" data-ready={entry.ready}>
      <QueueMark entry={entry} copy={copy} />
      {entry.name ? <span className="ticket-name">{entry.name}</span> : <span />}
      <span className="ticket-marks">
        {entry.tier ? <TierBadge tier={entry.tier} copy={copy} /> : null}
        {entry.arrived ? (
          <span className="ticket-arrived">{formatCopy(copy, 'boardArrived')}</span>
        ) : null}
        {entry.provenance ? (
          <span className="ticket-provenance">{entry.provenance}</span>
        ) : null}
      </span>
    </li>
  );
}

export { STALE_AFTER_MS, RECONCILE_MS };
