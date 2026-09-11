'use client';

import type { CSSProperties } from 'react';

import type { BoardConfig, BoardEntry } from '@platform/domain';
import type { BoardTicketRow } from '@platform/schema';
import { formatCopy, type BrandCopy } from '@platform/ui/copy';

import { TIER_TONE_VARIABLE } from '@/lib/theme';
import { useBoardQueue } from './use-board-queue';

export type BoardViewProps = {
  initialTickets: BoardTicketRow[];
  config: BoardConfig;
  copy: BrandCopy;
  /** Absent when the deployment has no database; the board then runs on fixtures. */
  live: boolean;
  /** True when the server's own read failed and this is a degraded board. */
  degraded: boolean;
  demoSynced: boolean;
};

export function BoardView({ initialTickets, config, copy, live, degraded, demoSynced }: BoardViewProps) {
  const { queue, freshness } = useBoardQueue({
    initialTickets, config, live, degraded, demoSynced,
  });

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
 * The mark at the head of a row: the place in line, which becomes a check.
 *
 * The number is `entry.position`, not `entry.callout`. A guest reads this
 * column as "how many people are ahead of me", so it has to start at one and
 * count the line -- a daily call-out starting at 38 answers a question nobody
 * asked. The call-out still identifies the order and stays in the row's
 * accessible label, where it is the thing a name gets called with.
 *
 * Both marks are mounted at once and swapped with a transition rather than a
 * keyframe animation. A CSS transition settles at its end state; a keyframe
 * animation holds its *start* state for as long as it is paused, and a browser
 * pauses animations in a backgrounded tab -- which is how "Here" managed to be
 * invisible. The resting state of a check is therefore declared, not animated.
 */
function QueueMark({ entry, copy }: { entry: BoardEntry; copy: BrandCopy }) {
  const place = entry.position === null ? '' : String(entry.position);
  return (
    <span
      className="ticket-mark"
      data-ready={entry.ready}
      role="img"
      aria-label={entry.ready
        ? `${entry.callout}, ${formatCopy(copy, 'boardReady')}`
        : `${entry.callout}, ${formatCopy(copy, 'boardPosition', { position: place })}`}
    >
      <span className="ticket-position" aria-hidden="true">{place}</span>
      <svg className="ticket-check" viewBox="0 0 24 24" aria-hidden="true">
        <circle className="ticket-check-ring" cx="12" cy="12" r="10.5" />
        <path className="ticket-check-tick" d="M6.8 12.4l3.4 3.4 6.9-7.3" />
      </svg>
    </span>
  );
}

/**
 * The live state of one order, as a word beside the name.
 *
 * `ready` is deliberately absent: the check and the top of the list already
 * say it twice, and a third mark saying it again is noise on a wall. This pill
 * exists for the difference the board could not previously show at all --
 * between an order the shop has taken and one a barista is making right now.
 */
const WAITING_STATUS_COPY: Partial<Record<BoardEntry['status'], string>> = {
  paid: 'boardQueued',
  in_progress: 'boardMaking',
};

function StatusPill({ entry, copy }: { entry: BoardEntry; copy: BrandCopy }) {
  const key = entry.ready ? undefined : WAITING_STATUS_COPY[entry.status];
  if (!key) return null;
  return (
    <span className="ticket-status" data-status={entry.status}>
      <i className="ticket-status-dot" aria-hidden="true" />
      {formatCopy(copy, key)}
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
        <StatusPill entry={entry} copy={copy} />
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

export { STALE_AFTER_MS, RECONCILE_MS, DEMO_SYNC_RECONCILE_MS } from './use-board-queue';
