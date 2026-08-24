/**
 * Turning a kiosk bag into the one wire shape the platform accepts.
 *
 * The client sends SLUGS and a tender; it never sends money. `createOrder`
 * reprices every line from `menu_items` and the brand's tax config, so a
 * tampered kiosk can change what is ordered but not what it costs. That is why
 * this function deliberately drops `unitPriceCents` on the floor rather than
 * passing it along to be "verified".
 *
 * Pure, so `node:test` covers it without a network or a renderer.
 */
import type { OrderLine, OrderCart } from '@platform/domain';
import type { PlaceOrderRequest, PlaceOrderLine, TenderType } from '@platform/api-client';

export type OrderRequestInput = {
  cart: OrderCart;
  locationId: string;
  tenderType: TenderType;
  tipCents?: number;
  /** Already validated with `parseGuestLabel`; omitted when absent. */
  guestLabel?: string | null;
};

export class EmptyBagError extends Error {
  constructor() {
    super('There is nothing in the bag to order.');
    this.name = 'EmptyBagError';
  }
}

export function toPlaceOrderRequest(input: OrderRequestInput): PlaceOrderRequest {
  const lines = input.cart.lines.map(toLine);
  // Refuse here rather than letting the server answer 400: a kiosk that posts
  // an empty order has a bug upstream, and the guest should never see it.
  if (lines.length === 0) throw new EmptyBagError();

  return {
    locationId: input.locationId,
    // A kiosk order is collected at the counter of the shop it was placed in.
    // Nothing on this surface offers delivery or a scheduled window.
    fulfillmentType: 'pickup',
    lines,
    tipCents: Math.max(0, Math.trunc(input.tipCents ?? 0)),
    tenderType: input.tenderType,
    ...(input.guestLabel ? { guestLabel: input.guestLabel } : {}),
  };
}

function toLine(line: OrderLine): PlaceOrderLine {
  return {
    itemSlug: line.itemId,
    sizeSlug: line.sizeSlug,
    quantity: line.quantity,
    // Sorted upstream, so the same drink produces the same request whichever
    // order the guest tapped its options in.
    modifierSlugs: [...line.optionIds],
  };
}
