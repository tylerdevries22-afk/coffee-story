import type { BoardTicketRow } from '@platform/schema';

import { serverClient } from './supabase-server';
import { currentSession } from './auth';
import { DEMO_SESSION } from './demo-data';
import { usesLaunchFixtures } from './demo-fixture-scope';

export type WallPreviewTicket = Pick<
  BoardTicketRow,
  | 'id'
  | 'brand_id'
  | 'location_id'
  | 'daily_number'
  | 'guest_label'
  | 'status'
  | 'fulfillment_type'
  | 'channel'
  | 'arrived_at'
  | 'loyalty_tier'
  | 'updated_at'
>;

const DEMO_TICKETS: WallPreviewTicket[] = [
  {
    id: 'wall-preview-1', brand_id: 'demo', location_id: 'loc-downtown',
    daily_number: 104, guest_label: 'Maya', status: 'ready', fulfillment_type: 'pickup',
    channel: 'app', arrived_at: null, loyalty_tier: null, updated_at: '2026-08-27T15:00:00Z',
  },
  {
    id: 'wall-preview-2', brand_id: 'demo', location_id: 'loc-downtown',
    daily_number: 105, guest_label: 'Jordan', status: 'in_progress', fulfillment_type: 'pickup',
    channel: 'kiosk', arrived_at: null, loyalty_tier: null, updated_at: '2026-08-27T15:01:00Z',
  },
];

/** Reads only the display-safe projection under the signed-in HQ session. */
export async function loadWallPreviewTickets(locationId: string): Promise<WallPreviewTicket[]> {
  const client = await serverClient();
  const session = await currentSession();
  if (!session) return [];
  const { selectedOrganizationId } = await import('./workspace-scope');
  const brandId = await selectedOrganizationId(session);
  if (!client) {
    if (!usesLaunchFixtures(brandId, DEMO_SESSION.brandId)) return [];
    return DEMO_TICKETS.map((ticket) => ({ ...ticket, location_id: locationId }));
  }

  const rows = await client
    .from('board_tickets')
    .select('id, brand_id, location_id, daily_number, guest_label, status, fulfillment_type, channel, arrived_at, loyalty_tier, updated_at')
    .eq('brand_id', brandId)
    .eq('location_id', locationId)
    .in('status', ['paid', 'in_progress', 'ready'])
    .order('updated_at', { ascending: true })
    .returns<WallPreviewTicket[]>();
  if (rows.error) throw new Error(`board_tickets: ${rows.error.message}`);
  return rows.data ?? [];
}
