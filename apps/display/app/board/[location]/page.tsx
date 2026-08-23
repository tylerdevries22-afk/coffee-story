import { isConfigured, loadBoardTickets, loadLocationName } from '@/lib/board';

import { BoardView } from './board-view';

/**
 * The pickup display: /board/<locationId>.
 *
 * Rendered server-side on first paint so a TV that reboots at 5am shows the
 * board immediately rather than a spinner nobody is there to watch, then keeps
 * itself current from the client.
 */
export const dynamic = 'force-dynamic';

export default async function BoardPage({ params }: { params: Promise<{ location: string }> }) {
  const { location } = await params;
  const [tickets, name] = await Promise.all([
    loadBoardTickets(location),
    loadLocationName(location),
  ]);
  return <BoardView locationName={name} initialTickets={tickets} live={isConfigured()} />;
}
