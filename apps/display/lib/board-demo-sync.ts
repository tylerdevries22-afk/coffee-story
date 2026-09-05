import {
  createDemoSyncClient, type DemoSyncBoardTicket, type DemoSyncClient,
} from '@platform/api-client';
import type { BoardTicketRow } from '@platform/schema';

import { demoBoardAt } from './demo-board';

export const demoSyncClient = createDemoSyncClient(process.env.DEMO_SYNC_URL, 'pos');

export function previewWallEnabled(flag: string | undefined, syncConfigured: boolean): boolean {
  return flag === '1' && syncConfigured;
}

export const synchronizedPreview = previewWallEnabled(
  process.env.PREVIEW_WALL,
  demoSyncClient !== null,
);

const ACTIVE_BOARD_STATUSES = new Set(['paid', 'in_progress', 'ready']);

function demoSyncTickets(tickets: DemoSyncBoardTicket[], locationId: string): BoardTicketRow[] {
  return tickets.filter((ticket) => ACTIVE_BOARD_STATUSES.has(ticket.status)).map((ticket) => ({
    id: ticket.id, brand_id: 'brand-demo', location_id: locationId,
    daily_number: ticket.dailyNumber, guest_label: ticket.guestName,
    status: ticket.status as BoardTicketRow['status'],
    fulfillment_type: ticket.fulfillmentType, channel: ticket.channel,
    arrived_at: null, loyalty_tier: null, updated_at: ticket.updatedAt,
  }));
}

/** Uses one broker roster when available, with the local demo cycle as fallback. */
export async function synchronizedFixtureTickets(
  locationId: string,
  syncClient: Pick<DemoSyncClient, 'board'> | null = demoSyncClient,
  now = Date.now(),
): Promise<BoardTicketRow[]> {
  const base = demoBoardAt(now, locationId);
  if (!syncClient) return base;
  const synchronized = demoSyncTickets(await syncClient.board(), locationId);
  return synchronized.length > 0 ? synchronized : base;
}
