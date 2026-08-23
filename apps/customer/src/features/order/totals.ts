/**
 * Register arithmetic for a client order.
 *
 * Integer cents throughout, for the same reason `features/staff/pos-totals.ts`
 * works in cents: every amount the app already handles is integer cents, and
 * routing money through floats to share one module would reintroduce the
 * rounding that representation exists to avoid.
 *
 * The two registers stay separate on purpose. The staff one settles an
 * order balance against a percentage tip and a flat discount code; this
 * one prices a bag of goods against a fixed-dollar tip and an itemised tax
 * breakdown the guest can read line by line.
 */
import { pointsForPurchase, REWARD_TIERS, type PurchaseBreakdown, type RewardTier } from '@/features/rewards/rules';
import { TAX_JURISDICTIONS, taxRowsFor, type TaxJurisdiction, type TaxRow } from '@/features/tax';

export { TAX_JURISDICTIONS };
export type { TaxJurisdiction, TaxRow };

export type OrderTotals = {
  subtotalCents: number;
  deliveryFeeCents: number;
  discountCents: number;
  /** What the discount came off, and what tax is owed on. */
  taxableCents: number;
  taxRows: TaxRow[];
  /** Exactly the sum of `taxRows`, so the printed rows add up to the total. */
  taxCents: number;
  tipCents: number;
  totalCents: number;
};

/** Tip chips on the checkout screen, plus a free-entry "Other". */
export const TIP_PRESETS_CENTS: readonly number[] = [200, 300, 500];

/** Flat fee on a delivery order. Pickup pays nothing. */
export const DELIVERY_FEE_CENTS = 399;

export type OrderTotalsInput = {
  subtotalCents: number;
  /** 0 for pickup. Taxed with the goods, as Colorado treats delivery charges. */
  deliveryFeeCents?: number;
  /** Reward cash or a promo code. Clamped so it can never create money. */
  discountCents?: number;
  /** A fixed amount, not a rate: the tip chips are dollar amounts. */
  tipCents?: number;
  jurisdictions?: readonly TaxJurisdiction[];
};

function wholeCents(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
}

export function orderTotals({
  subtotalCents,
  deliveryFeeCents,
  discountCents,
  tipCents,
  jurisdictions = TAX_JURISDICTIONS,
}: OrderTotalsInput): OrderTotals {
  const goodsCents = wholeCents(subtotalCents);
  const deliveryCents = wholeCents(deliveryFeeCents);
  const chargeableCents = goodsCents + deliveryCents;
  // Clamped to the chargeable amount. An unclamped discount drives the taxable
  // base negative and starts refunding tax the shop never collected.
  const discount = Math.min(wholeCents(discountCents), chargeableCents);
  const taxableCents = chargeableCents - discount;

  // `features/tax.ts` owns the rounding: each row is rounded on its own and
  // the total is their sum, so the printed rows always add up to the total
  // above them, and the staff register reaches the same number.
  const taxRows = taxRowsFor(taxableCents, jurisdictions);
  const taxCents = taxRows.reduce((total, row) => total + row.amountCents, 0);

  // The tip is the barista's and rides on top of everything: a shop-side
  // discount should not quietly reduce it, and it is never taxed.
  const tip = wholeCents(tipCents);

  return {
    subtotalCents: goodsCents,
    deliveryFeeCents: deliveryCents,
    discountCents: discount,
    taxableCents,
    taxRows,
    taxCents,
    tipCents: tip,
    totalCents: taxableCents + taxCents + tip,
  };
}

/**
 * The order expressed in the shape `features/rewards/rules.ts` scores.
 *
 * Goods, delivery and tip qualify; tax does not. That split is the ladder's
 * existing rule (`qualifyingSpendCents`), not a new one invented here.
 */
export function orderPurchaseBreakdown(totals: OrderTotals): PurchaseBreakdown {
  // The two split the taxable base rather than the pre-discount amounts, so
  // they always sum back to what the guest actually paid for goods. A discount
  // large enough to swallow the goods eats into delivery next, never below zero.
  const deliveryCents = Math.min(totals.deliveryFeeCents, totals.taxableCents);
  return {
    itemsCents: totals.taxableCents - deliveryCents,
    giftCardsCents: 0,
    deliveryCents,
    tipsCents: totals.tipCents,
    taxesCents: totals.taxCents,
    serviceFeesCents: 0,
    paidWithGiftCardCents: 0,
    paidWithRewardsCents: 0,
  };
}

/** "Earn 96 Beans for this order" — the number in that banner. */
export function pointsForOrder(
  totals: OrderTotals,
  annualPoints: number,
  tiers: readonly RewardTier[] = REWARD_TIERS,
): number {
  return pointsForPurchase(orderPurchaseBreakdown(totals), annualPoints, tiers);
}
