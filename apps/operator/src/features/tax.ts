/**
 * Sales tax, stated once for the whole app.
 *
 * The client checkout and the staff register used to charge different rates on
 * the same sale: the register had a flat `TAX_RATE = 0.08` and the new client
 * checkout itemised Aurora's four authorities at 7.90%. One shop, two tax
 * rates, and a guest who ordered ahead paid a different total from one who
 * ordered at the bar.
 *
 * Pure — no asset imports — so `node:test` reaches it.
 */

export type TaxJurisdiction = {
  id: string;
  label: string;
  /** Fractional rate, e.g. 0.029 for 2.90%. */
  rate: number;
};

export type TaxRow = TaxJurisdiction & { amountCents: number };

/**
 * The four authorities that stack on a sale at 2222 S Havana St, Aurora CO
 * 80014 (Arapahoe County): 2.90 + 3.75 + 1.00 + 0.25 = 7.90%.
 *
 * They are broken out rather than summed because the guest sees each one on
 * the checkout screen, and because a change from any single authority should
 * be a one-line edit here. The owner must confirm these against their current
 * Colorado sales-tax licence before the app charges live money — this module
 * is the only place they are stated.
 */
export const TAX_JURISDICTIONS: readonly TaxJurisdiction[] = [
  { id: 'state', label: 'State Sales Tax', rate: 0.029 },
  { id: 'city', label: 'City of Aurora Sales Tax', rate: 0.0375 },
  { id: 'rtd', label: 'Regional Transportation District Tax', rate: 0.01 },
  { id: 'county', label: 'Arapahoe County Tax', rate: 0.0025 },
] as const;

/**
 * Tax owed on a taxable base, one row per authority.
 *
 * Each row is rounded on its own and the total is their sum, never a separate
 * rounding of the combined rate. Rounding once at the end lets the printed
 * rows disagree with the total they sit above by a cent, which is the kind of
 * receipt a guest photographs and sends to the shop.
 */
export function taxRowsFor(
  taxableCents: number,
  jurisdictions: readonly TaxJurisdiction[] = TAX_JURISDICTIONS,
): TaxRow[] {
  const base = Number.isFinite(taxableCents) ? Math.max(0, Math.round(taxableCents)) : 0;
  return jurisdictions.map((jurisdiction) => ({
    ...jurisdiction,
    amountCents: Math.round(base * Math.max(0, jurisdiction.rate)),
  }));
}

/** Exactly the sum of `taxRowsFor`, so a receipt and a register agree. */
export function taxCentsFor(
  taxableCents: number,
  jurisdictions: readonly TaxJurisdiction[] = TAX_JURISDICTIONS,
): number {
  return taxRowsFor(taxableCents, jurisdictions).reduce((total, row) => total + row.amountCents, 0);
}

/** The combined rate, for anywhere that needs to state one number. */
export const COMBINED_TAX_RATE = TAX_JURISDICTIONS.reduce((total, tax) => total + tax.rate, 0);
