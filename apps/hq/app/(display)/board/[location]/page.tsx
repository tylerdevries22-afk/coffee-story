import { loadBoardTickets, loadLocations } from '@/lib/data';
import { isConfigured } from '@/lib/supabase-server';

import { BoardView } from './board-view';

/**
 * The pickup display: /board/<locationId>.
 *
 * A wall screen, not a console page. It renders server-side on first paint so
 * a tablet that reboots at 5am shows the board immediately rather than a
 * spinner, then keeps itself current from the client.
 */
export const dynamic = 'force-dynamic';

export default async function BoardPage({ params }: { params: Promise<{ location: string }> }) {
  const { location } = await params;
  const [tickets, locations] = await Promise.all([loadBoardTickets(location), loadLocations()]);
  const name = locations.find((entry) => entry.id === location)?.name ?? 'Pickup';
  return <BoardView locationName={name} initialTickets={tickets} live={isConfigured()} />;
}
