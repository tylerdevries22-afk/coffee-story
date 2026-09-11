export type SquareCardFundingAmounts = {
  providerOrderTotalCents: number;
  providerTipCents: number;
};

/** Match the card-funded Square Order and tip split used by attended capture. */
export function squareCardFundingAmounts(
  grossCents: number,
  tipCents: number,
): SquareCardFundingAmounts {
  if (!Number.isSafeInteger(grossCents) || grossCents <= 0
    || !Number.isSafeInteger(tipCents) || tipCents < 0) {
    throw new RangeError('Square card funding amounts must be valid integer cents.');
  }
  const providerTipCents = grossCents > tipCents ? tipCents : 0;
  return {
    providerOrderTotalCents: grossCents - providerTipCents,
    providerTipCents,
  };
}
