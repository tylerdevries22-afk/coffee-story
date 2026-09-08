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
  status?: string;
  total_money?: { amount?: number; currency?: string };
  app_fee_money?: { amount?: number; currency?: string };
};

/** Check the provider receipt before publishing a local payment success. */
export function settledPaymentFee(
  payment: SquarePaymentReceipt | undefined,
  paymentId: string,
  grossCents: number,
): { feeCents: number; feeBpsApplied: number } {
  const feeCents = squareAppFeeCents(payment?.app_fee_money);
  const totalCents = squareUsdCents(payment?.total_money);
  if (!paymentId || payment?.id !== paymentId || payment.status !== 'COMPLETED'
    || !Number.isSafeInteger(grossCents) || grossCents <= 0
    || totalCents !== grossCents
    || feeCents === null || feeCents > grossCents) {
    throw new Error('Square returned an invalid settlement receipt.');
  }
  return { feeCents, feeBpsApplied: Math.round((feeCents / grossCents) * 10_000) };
}
