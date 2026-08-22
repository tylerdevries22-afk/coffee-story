/**
 * How a checkout total is covered: loyalty redemption first (a discount, so
 * it shrinks the taxable base upstream), then stored value (gift balance,
 * which is tender -- it pays the total but never shrinks it), then the card
 * for whatever remains. Integer cents throughout.
 */

/** 20 Beans buy $1.00 off. Assumption to confirm with the client (Phase 4 commit). */
export const POINTS_PER_DOLLAR_REDEEMED = 20;

/** Largest whole-dollar redemption the balance and the subtotal both allow. */
export function maxRedeemableCents(pointsBalance: number, subtotalCents: number): number {
  if (!Number.isInteger(pointsBalance) || pointsBalance <= 0) return 0;
  if (!Number.isInteger(subtotalCents) || subtotalCents <= 0) return 0;
  const byPoints = Math.floor(pointsBalance / POINTS_PER_DOLLAR_REDEEMED) * 100;
  const bySubtotal = Math.floor(subtotalCents / 100) * 100;
  return Math.min(byPoints, bySubtotal);
}

export function pointsForRedemption(redeemCents: number): number {
  return Math.ceil(redeemCents / 100) * POINTS_PER_DOLLAR_REDEEMED;
}

export type PaymentSplit = {
  storedValueAppliedCents: number;
  cardChargeCents: number;
};

/** Gift balance covers what it can; the card covers the rest. */
export function splitPayment(totalCents: number, storedValueBalanceCents: number, useStoredValue: boolean): PaymentSplit {
  const total = Math.max(0, Math.trunc(totalCents));
  if (!useStoredValue || storedValueBalanceCents <= 0) {
    return { storedValueAppliedCents: 0, cardChargeCents: total };
  }
  const applied = Math.min(total, Math.trunc(storedValueBalanceCents));
  return { storedValueAppliedCents: applied, cardChargeCents: total - applied };
}
