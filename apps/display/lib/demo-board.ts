import type { BoardTicketRow } from '@platform/schema';

/**
 * A board mid-shift, for reviewing the screen with no database.
 *
 * Shaped to exercise what the display has to handle rather than to look tidy:
 * a long name against a short one, both columns occupied, and a curbside guest
 * who has already tapped "I'm here".
 */
export const DEMO_BOARD: readonly BoardTicketRow[] = [
  {
    id: 'tkt-41', brand_id: 'brand-coffee-story', location_id: 'demo',
    daily_number: 41, guest_label: 'Devin P.', status: 'in_progress',
    fulfillment_type: 'pickup', arrived_at: null, updated_at: '2026-08-23T15:04:00.000Z',
  },
  {
    id: 'tkt-42', brand_id: 'brand-coffee-story', location_id: 'demo',
    daily_number: 42, guest_label: 'Alex Rivera', status: 'in_progress',
    fulfillment_type: 'pickup', arrived_at: null, updated_at: '2026-08-23T15:04:00.000Z',
  },
  {
    id: 'tkt-43', brand_id: 'brand-coffee-story', location_id: 'demo',
    daily_number: 43, guest_label: 'Sam', status: 'paid',
    fulfillment_type: 'pickup', arrived_at: null, updated_at: '2026-08-23T15:04:00.000Z',
  },
  {
    id: 'tkt-39', brand_id: 'brand-coffee-story', location_id: 'demo',
    daily_number: 39, guest_label: 'Harper E.', status: 'ready',
    fulfillment_type: 'pickup', arrived_at: null, updated_at: '2026-08-23T15:04:00.000Z',
  },
  {
    id: 'tkt-40', brand_id: 'brand-coffee-story', location_id: 'demo',
    daily_number: 40, guest_label: 'Quinn N.', status: 'ready',
    fulfillment_type: 'curbside', arrived_at: '2026-08-23T15:03:10.000Z',
    updated_at: '2026-08-23T15:04:00.000Z',
  },
];

const DEMO_NAMES: Readonly<Record<string, string>> = {
  'loc-downtown': 'Downtown',
  'loc-uptown': 'Uptown',
};

export function demoLocationName(locationId: string): string {
  return DEMO_NAMES[locationId] ?? 'Downtown';
}
