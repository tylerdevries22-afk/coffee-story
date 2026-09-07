/** Only USD integer cents cross the provider settlement boundary. */
export function squareAppFeeCents(money: unknown): number | null {
  if (money === undefined) return 0;
  if (typeof money !== 'object' || money === null) return null;
  const value = money as { amount?: unknown; currency?: unknown };
  return typeof value.amount === 'number' && Number.isSafeInteger(value.amount)
    && value.amount >= 0 && value.currency === 'USD' ? value.amount : null;
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
  if (!paymentId || payment?.id !== paymentId || payment.status !== 'COMPLETED'
    || !Number.isSafeInteger(grossCents) || grossCents <= 0
    || payment.total_money?.currency !== 'USD' || payment.total_money.amount !== grossCents
    || feeCents === null || feeCents > grossCents) {
    throw new Error('Square returned an invalid settlement receipt.');
  }
  return { feeCents, feeBpsApplied: Math.round((feeCents / grossCents) * 10_000) };
}
