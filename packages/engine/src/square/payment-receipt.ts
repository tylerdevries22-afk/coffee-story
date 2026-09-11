/** Parse a required Square Money value at the provider settlement boundary. */
export function squareUsdCents(money: unknown): number | null {
  if (typeof money !== 'object' || money === null) return null;
  const value = money as { amount?: unknown; currency?: unknown };
  return typeof value.amount === 'number' && Number.isSafeInteger(value.amount)
    && value.amount >= 0 && value.currency === 'USD' ? value.amount : null;
}

/** Square omits app_fee_money when no application fee was collected. */
export function squareAppFeeCents(money: unknown): number | null {
  return money === undefined ? 0 : squareUsdCents(money);
}

export type SquarePaymentReceipt = {
  id?: string;
  order_id?: string;
  location_id?: string;
  status?: string;
  total_money?: { amount?: number; currency?: string };
  app_fee_money?: { amount?: number; currency?: string };
};

/** Square's USD application-fee ceiling: 60% below $5, otherwise 90%. */
export function squareApplicationFeeCapCents(grossCents: number): number {
  if (!Number.isSafeInteger(grossCents) || grossCents <= 0) {
    throw new RangeError('Square payment gross must be positive integer cents.');
  }
  const fraction = grossCents < 500 ? [3n, 5n] as const : [9n, 10n] as const;
  return Number((BigInt(grossCents) * fraction[0]) / fraction[1]);
}

/** Check the provider receipt before publishing a local payment success. */
export function settledPaymentFee(
  payment: SquarePaymentReceipt | undefined,
  paymentId: string,
  grossCents: number,
  expectedFeeCents: number,
  expectedLocationId: string,
): { feeCents: number; feeBpsApplied: number } {
  const feeCents = squareAppFeeCents(payment?.app_fee_money);
  const totalCents = squareUsdCents(payment?.total_money);
  if (!paymentId || payment?.id !== paymentId || payment.status !== 'COMPLETED'
    || !expectedLocationId || payment.location_id !== expectedLocationId
    || !Number.isSafeInteger(grossCents) || grossCents <= 0
    || !Number.isSafeInteger(expectedFeeCents) || expectedFeeCents < 0
    || expectedFeeCents > squareApplicationFeeCapCents(grossCents)
    || totalCents !== grossCents
    || feeCents === null || feeCents !== expectedFeeCents) {
    throw new Error('Square returned an invalid settlement receipt.');
  }
  return { feeCents, feeBpsApplied: Math.round((feeCents / grossCents) * 10_000) };
}
