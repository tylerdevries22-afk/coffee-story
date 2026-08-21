/**
 * Register arithmetic and cart mutations for the staff checkout.
 *
 * Extracted from checkout-screen.tsx so `node:test` can reach it: the mobile
 * test runner globs `src/**\/*.test.ts`, so anything living in a `.tsx`
 * component body is structurally untestable, and this is the money path.
 *
 * The web register has a twin at lib/booking/pos-totals.ts. It works in whole
 * dollars; this works in cents, because every amount the mobile app handles --
 * `PortalAppointment.balanceCents`, service prices, tender totals -- is already
 * integer cents, and converting to floats to share one module would reintroduce
 * the rounding the cents representation exists to avoid.
 */

export type CartLine = {
  id: string;
  name: string;
  priceCents: number;
  qty: number;
};

export type RegisterTotals = {
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  /** What the discount is actually applied to, and what tax is owed on. */
  taxableCents: number;
  /** Ticket before tip: taxable + tax. */
  baseCents: number;
  tipCents: number;
  totalCents: number;
  /** What Stripe is actually asked for. See the note on `registerTotals`. */
  cardChargeCents: number;
  /** Recorded on the ticket but not charged to the card. */
  extrasCents: number;
};

export const TAX_RATE = 0.08;
export const DISCOUNT_CODE_CENTS = 1500;
export const MEMBERSHIP_CREDIT_CENTS = 2500;

/** Line id for the visit the sale is attached to; at most one exists. */
export const VISIT_LINE_ID = 'visit-balance';

export const TIP_OPTIONS = ['No tip', '10%', '15%', '20%'] as const;
export type TipOption = (typeof TIP_OPTIONS)[number];
export const TIP_RATES: Record<TipOption, number> = {
  'No tip': 0,
  '10%': 0.1,
  '15%': 0.15,
  '20%': 0.2,
};

export const ADD_ONS: readonly { name: string; priceCents: number }[] = [
  { name: 'Aromatherapy', priceCents: 1500 },
  { name: 'CBD balm', priceCents: 2000 },
  { name: 'Hot stones', priceCents: 2500 },
  { name: 'Extra 15 min', priceCents: 3000 },
];

export const GIFT_AMOUNTS_CENTS: readonly number[] = [5000, 10000, 15000, 20000];

/**
 * Totals for a ticket.
 *
 * `visitBalanceCents` is the selected appointment's outstanding balance, or
 * null when the sale is not attached to a visit. Stripe prices the visit
 * server-side, so a card tender settles that balance plus tip and never the
 * ticket total -- anything above it is recorded, not charged, which is what
 * `extrasCents` reports to the payment screen.
 */
export function registerTotals({
  cart,
  codeApplied = false,
  membershipCredit = false,
  tipRate = 0,
  visitBalanceCents = null,
}: {
  cart: readonly CartLine[];
  codeApplied?: boolean;
  membershipCredit?: boolean;
  tipRate?: number;
  visitBalanceCents?: number | null;
}): RegisterTotals {
  const subtotalCents = cart.reduce((sum, line) => sum + line.priceCents * line.qty, 0);
  // Clamped to the subtotal: an unclamped discount drives the taxable base
  // negative and the discount starts creating money.
  const discountCents = Math.min(
    (codeApplied ? DISCOUNT_CODE_CENTS : 0) + (membershipCredit ? MEMBERSHIP_CREDIT_CENTS : 0),
    subtotalCents,
  );
  // Tax is owed on what the customer actually pays for the goods, so it follows
  // the discount. Computing it on the pre-discount subtotal overcharges tax on
  // every discounted ticket -- an $85 visit with the $25 membership credit
  // billed $6.80 instead of $4.80. lib/booking/pos-totals.ts fixed exactly this
  // on the web register; the mobile one kept the original shape until now.
  const taxableCents = subtotalCents - discountCents;
  const taxCents = Math.round(taxableCents * TAX_RATE);
  const baseCents = taxableCents + taxCents;
  // Tip rides on the PRE-discount subtotal on purpose: it is the therapist's,
  // and a studio-side discount should not quietly reduce it. Same rule as
  // lib/booking/pos-totals.ts.
  const tipCents = Math.round(subtotalCents * tipRate);
  const totalCents = baseCents + tipCents;
  const cardChargeCents = visitBalanceCents === null ? totalCents : visitBalanceCents + tipCents;
  const extrasCents = Math.max(0, totalCents - cardChargeCents);

  return {
    subtotalCents,
    discountCents,
    taxableCents,
    taxCents,
    baseCents,
    tipCents,
    totalCents,
    cardChargeCents,
    extrasCents,
  };
}

/** The single line representing the visit a sale is attached to. */
export function visitLines(
  appointment: { serviceName: string; balanceCents: number } | undefined,
): CartLine[] {
  if (!appointment) return [];
  return [{
    id: VISIT_LINE_ID,
    name: appointment.serviceName,
    priceCents: appointment.balanceCents,
    qty: 1,
  }];
}

/** Replaces the visit line, keeping every add-on already rung up. */
export function selectVisitLines(
  cart: readonly CartLine[],
  appointment: { serviceName: string; balanceCents: number } | undefined,
): CartLine[] {
  return [...visitLines(appointment), ...cart.filter((line) => line.id !== VISIT_LINE_ID)];
}

/** Adds one of `name`, merging into an identical line rather than repeating it. */
export function addCartLine(
  cart: readonly CartLine[],
  name: string,
  priceCents: number,
): CartLine[] {
  const existing = cart.find((line) => line.name === name && line.priceCents === priceCents);
  if (existing) {
    return cart.map((line) => (line === existing ? { ...line, qty: line.qty + 1 } : line));
  }
  return [...cart, { id: `${name}-${priceCents}-${cart.length}`, name, priceCents, qty: 1 }];
}

/** Changes a line's quantity, dropping it once it reaches zero. */
export function changeCartQty(cart: readonly CartLine[], id: string, delta: number): CartLine[] {
  return cart.flatMap((line) => {
    if (line.id !== id) return [line];
    const qty = line.qty + delta;
    return qty <= 0 ? [] : [{ ...line, qty }];
  });
}

export function removeCartLine(cart: readonly CartLine[], id: string): CartLine[] {
  return cart.filter((line) => line.id !== id);
}
