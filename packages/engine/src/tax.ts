/**
 * Sales tax as the server computes it. The rate table is data (each brand
 * states its authorities in brand_config.tax.jurisdictions), never code, so
 * the platform carries no tenant's tax situation in a source file.
 *
 * Each authority's row is rounded on its own and the total is the sum of the
 * rows (CLAUDE.md money rule): the receipt's printed rows always equal the
 * total they sit above.
 */

export type TaxJurisdiction = {
  id: string;
  label: string;
  /** Fractional rate, e.g. 0.029 for 2.90%. */
  rate: number;
};

export type TaxRow = TaxJurisdiction & { amountCents: number };

export function taxRowsFor(
  taxableCents: number,
  jurisdictions: readonly TaxJurisdiction[],
): TaxRow[] {
  const base = Number.isFinite(taxableCents) ? Math.max(0, Math.round(taxableCents)) : 0;
  return jurisdictions.map((jurisdiction) => ({
    ...jurisdiction,
    amountCents: Math.round(base * Math.max(0, jurisdiction.rate)),
  }));
}

/** Exactly the sum of `taxRowsFor`, so a receipt and the orders row agree. */
export function taxCentsFor(
  taxableCents: number,
  jurisdictions: readonly TaxJurisdiction[],
): number {
  return taxRowsFor(taxableCents, jurisdictions).reduce((total, row) => total + row.amountCents, 0);
}

/**
 * The jurisdiction list out of a brand_config value. Malformed entries are
 * rejected as a unit rather than skipped: silently dropping one authority
 * would undercharge tax on every order.
 */
export function parseTaxJurisdictions(config: unknown): TaxJurisdiction[] {
  const raw = (config as { tax?: { jurisdictions?: unknown } } | null)?.tax?.jurisdictions;
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new Error('brand_config.tax.jurisdictions must be an array.');
  return raw.map((entry) => {
    const candidate = entry as { id?: unknown; label?: unknown; rate?: unknown };
    if (
      typeof candidate.id !== 'string'
      || typeof candidate.label !== 'string'
      || typeof candidate.rate !== 'number'
      || !Number.isFinite(candidate.rate)
      || candidate.rate < 0
      || candidate.rate >= 1
    ) {
      throw new Error('brand_config.tax.jurisdictions entries need id, label and a fractional rate.');
    }
    return { id: candidate.id, label: candidate.label, rate: candidate.rate };
  });
}
