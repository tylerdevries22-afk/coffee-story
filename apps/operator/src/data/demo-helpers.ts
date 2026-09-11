import { taxCentsFor } from '@platform/domain';
import type { PortalOrder } from '@platform/domain';
import { DEMO_TAX_JURISDICTIONS } from '@/data/business';

// Sanitized, production-scale demo dataset. All names/emails/phones are fictional
// (example.com, 555 numbers). Every date is relative to portal creation so
// "upcoming" stays upcoming no matter when the app launches.
export const now = new Date();

function dayAt(daysFromNow: number, hour: number, minute = 0): Date {
  const value = new Date(now);
  value.setDate(value.getDate() + daysFromNow);
  value.setHours(hour, minute, 0, 0);
  return value;
}

export function isoAt(daysFromNow: number, hour: number, minute = 0): string {
  return dayAt(daysFromNow, hour, minute).toISOString();
}

const SHOP_LABEL = 'Coffee Story · 2222 S Havana St';
const DELIVERY_LABEL = 'Delivery';
const DELIVERY_DETAIL = '123 Dayton St, Aurora, CO 80010';

type OrderSeed = {
  id: string;
  /** One line's name; the demo carries single-line orders. */
  item: string;
  days: number;
  hour: number;
  minute?: number;
  priceCents: number;
  status: PortalOrder['status'];
  /** Display-safe guest name; becomes the order's guestLabel. */
  client?: string;
  mobile?: boolean;
};

/**
 * Orders are pay-at-pickup, so no deposit and no tip.
 *
 * Tax comes from the real jurisdiction table rather than a flat guess: this
 * feeds the same board and receipt surfaces as the live plane, and a total
 * that does not equal subtotal + tax only ever surfaces in a screenshot.
 */
export function order(seed: OrderSeed): PortalOrder {
  const placedAt = isoAt(seed.days, seed.hour, seed.minute);
  const taxCents = taxCentsFor(seed.priceCents, DEMO_TAX_JURISDICTIONS);
  return {
    id: seed.id,
    status: seed.status,
    summary: seed.item,
    lines: [{ name: seed.item, quantity: 1, unitPriceCents: seed.priceCents, options: [] }],
    fulfillmentType: seed.mobile ? 'delivery' : 'pickup',
    scheduledFor: placedAt,
    placedAt,
    subtotalCents: seed.priceCents,
    taxCents,
    tipCents: 0,
    totalCents: seed.priceCents + taxCents,
    note: '',
    guestLabel: seed.client,
    locationLabel: seed.mobile ? DELIVERY_LABEL : SHOP_LABEL,
    locationDetail: seed.mobile ? DELIVERY_DETAIL : undefined,
  };
}
