import { notFound } from 'next/navigation';
import { after } from 'next/server';

import { formatCopy } from '@platform/ui/copy';

import { isConfigured, isLocationId, loadBoard } from '@/lib/board';
import { recordDisplayScreen } from '@/lib/telemetry';

import { BoardView } from './board-view';
import { ActivityBoardView } from './activity-board-view';
import { QrPanel } from './qr-panel';

/**
 * The pickup display: /board/<locationId>.
 *
 * Rendered server-side on first paint so a TV that reboots at 5am shows the
 * board immediately rather than a spinner nobody is there to watch, then keeps
 * itself current from the client. The brand's palette, words and board
 * settings are resolved here too, in the same pass, so the first frame is
 * already the tenant's -- no flash of a fallback theme for the room to see.
 */
export const dynamic = 'force-dynamic';

export default async function BoardPage({ params }: { params: Promise<{ location: string }> }) {
  const { location } = await params;

  // Only when a database is actually behind this. On fixtures the route has to
  // stay reachable by a readable slug -- /board/loc-downtown is how this
  // surface gets demoed and screenshotted before any location row exists.
  if (isConfigured() && !isLocationId(location)) notFound();

  const board = await loadBoard(location);
  if (!board.unpaired && isLocationId(location)) {
    after(async () => { await recordDisplayScreen(location); });
  }

  // An unpaired production screen draws no queue at all. There is no honest
  // board to show -- the fixtures would be an invented one, and a blank board
  // would read as "nobody is waiting" to the room.
  if (board.unpaired) {
    return (
      <div className="display-root display-signpost" style={board.theme.cssVariables}>
        <h1 className="board-title">{formatCopy(board.copy, 'boardUnpairedTitle')}</h1>
        <p className="board-empty">{formatCopy(board.copy, 'boardUnpairedBody')}</p>
      </div>
    );
  }

  if (board.activityConfig.enabled) {
    return (
      <div className="display-root display-activity" style={board.theme.cssVariables}>
        <ActivityBoardView
          initialItems={board.activityItems}
          config={board.activityConfig}
          locationName={board.locationName}
          live={board.live}
          degraded={board.degraded}
        />
      </div>
    );
  }

  return (
    <div className="display-root" style={board.theme.cssVariables}>
      <BoardView
        initialTickets={board.tickets}
        config={board.config}
        copy={board.copy}
        live={board.live}
        degraded={board.degraded}
        demoSynced={board.demoSynced}
      />
      {board.config.appUrl ? <QrPanel url={board.config.appUrl} copy={board.copy} /> : null}
    </div>
  );
}
