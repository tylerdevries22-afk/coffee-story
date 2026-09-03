/**
 * How a guest pays, and what that choice means to `orders.tender_type`.
 *
 * The buttons and the settlement rule live together on purpose: which tenders
 * survive depends on what each one can settle, and separating them is how a
 * config ends up rendering a payment screen on which nothing can complete.
 */

import type { OrderTenderType } from '@platform/schema';

import { TENDERS } from './limits';
import { note, uniqueMembers } from './primitives';
import { DEFAULT_KIOSK_FLOW } from './types';

import type { KioskFlow, KioskFlowContext, KioskFlowNote, KioskTender } from './types';

/** Tenders the platform will not hand out on a config file's say-so alone. */
const FEATURE_GATED_TENDERS: Readonly<Record<string, 'stored_value'>> = {
  stored_value: 'stored_value',
  gift_card: 'stored_value',
};

/**
 * How a kiosk tender actually settles.
 *
 * `KioskTender` is the button a guest presses; `OrderTenderType` is how the
 * money settles on `orders.tender_type`. They are NOT the same axis, and the
 * two enums had zero overlapping values -- not one thing the kiosk could emit
 * was postable. Flattening them would have hidden the real distinction:
 *
 * A card or cash payment SETTLES an order. A stored-value or gift-card balance
 * does not -- it reduces the amount due, and whatever remains is settled by a
 * wire tender alongside it (`orders.stored_value_applied_cents`, and
 * `captureSquarePayment`'s `total_cents - stored_value_applied_cents`). A
 * balance is therefore not an `OrderTenderType` at all, and saying so here is
 * what stops a checkout screen trying to post one.
 */
export type KioskTenderSettlement =
  | { kind: 'wire'; tender: OrderTenderType }
  | { kind: 'balance' };

const TENDER_SETTLEMENT: Record<KioskTender, KioskTenderSettlement> = {
  // The reader. Whether a location can actually take one is the server's
  // answer, not the config's -- the kiosk only says what the guest chose.
  card: { kind: 'wire', tender: 'square_card' },
  // Settled at the counter when the guest collects.
  cash: { kind: 'wire', tender: 'pay_at_pickup' },
  stored_value: { kind: 'balance' },
  gift_card: { kind: 'balance' },
};

/** Total by construction: a new `KioskTender` is a type error until mapped. */
export function settlementFor(tender: KioskTender): KioskTenderSettlement {
  return TENDER_SETTLEMENT[tender];
}

/** The tenders that can settle an order on their own. */
export function wireTendersFor(flow: KioskFlow): readonly OrderTenderType[] {
  const wire: OrderTenderType[] = [];
  for (const tender of flow.tenders) {
    const settlement = settlementFor(tender);
    if (settlement.kind === 'wire' && !wire.includes(settlement.tender)) wire.push(settlement.tender);
  }
  return wire;
}

/**
 * The tenders on offer, intersected with what the platform has enabled.
 *
 * `features.stored_value` now arrives from the tenant's bundled module
 * manifest rather than from a `brand.json` boolean (apps/kiosk/src/tenant/
 * capabilities.ts), which changes where the answer comes from and nothing
 * about what this does with it.
 *
 * `card` always survives, and this path is therefore deliberately NOT
 * fail-closed. Everything else here denies on absence -- a balance tender the
 * tenant has not installed is dropped -- but a kiosk that cannot take a card
 * is not a kiosk, and denying the last settleable tender turns a config
 * mistake or a revoked module into a payment screen with no buttons and a
 * queue of guests who cannot pay. The safe failure for a tender list is the
 * one that still settles an order; refusing money is not the conservative
 * option at a counter.
 */
export function readTenders(
  value: unknown,
  features: KioskFlowContext['features'],
  notes: KioskFlowNote[] | null,
): readonly KioskTender[] {
  const listed = uniqueMembers(value, TENDERS);
  const allowed = listed.filter((tender) => {
    const required = FEATURE_GATED_TENDERS[tender];
    if (!required) return true;
    if (features?.[required] === true) return true;
    note(notes, 'kiosk.tenders', `"${tender}" needs the brand's stored-value feature switched on.`);
    return false;
  });
  // A balance reduces what is due; it cannot settle an order on its own. A
  // config listing only stored value would render a payment screen on which
  // nothing can complete, so a wire tender is always present.
  if (!allowed.some((tender) => settlementFor(tender).kind === 'wire')) {
    if (notes && allowed.length > 0) {
      note(notes, 'kiosk.tenders', 'Only balances were listed; card was added so an order can be settled.');
    }
    return [...DEFAULT_KIOSK_FLOW.tenders, ...allowed];
  }
  return allowed;
}
