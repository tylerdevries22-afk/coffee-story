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
 * There is deliberately no default jurisdiction list here.
 *
 * There used to be: Aurora, Colorado's four authorities, as the DEFAULT
 * PARAMETER of every function below and of `orderTotals`. The server was always
 * data-driven (`parseTaxJurisdictions` reads `brand_config`), so a second
 * tenant was never charged Colorado's rates -- but every client screen that
 * omitted the argument RENDERED them, by name. A Texas franchise showed
 * "City of Aurora Sales Tax" on its checkout and was charged something else.
 *
 * A shop's tax authorities are tenant data (`brand.json` -> `tax.jurisdictions`),
 * and the list is now a required argument so that omitting it is a type error
 * rather than a silently wrong screen. Coffee Story's own four live in
 * `tenants/coffee-story/brand.json`, where every other tenant fact lives.
 */

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
  jurisdictions: readonly TaxJurisdiction[],
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
  jurisdictions: readonly TaxJurisdiction[],
): number {
  return taxRowsFor(taxableCents, jurisdictions).reduce((total, row) => total + row.amountCents, 0);
}

/** The combined rate, for anywhere that needs to state one number. */
/** The stacked rate for a given list. Never a constant: it is per tenant. */
export function combinedTaxRate(jurisdictions: readonly TaxJurisdiction[]): number {
  return jurisdictions.reduce((total, tax) => total + Math.max(0, tax.rate), 0);
}

/**
 * The tenant's authorities, read from a brand config.
 *
 * The client twin of `parseTaxJurisdictions` in packages/engine, and
 * deliberately NOT the same function: the engine THROWS on a malformed list,
 * because the alternative there is undercharging real money. A screen has
 * nowhere to put that exception, so this drops bad entries and returns what
 * survives -- a checkout that renders one fewer tax row is recoverable; one
 * that crashes is not. The server recomputes every cent regardless, so the
 * screen is never the authority.
 *
 * Accepts the whole config (a `brand.json` or a `brand_config` row) and reaches
 * `.tax.jurisdictions`, so callers do not each re-derive the path.
 */
export function taxJurisdictionsFromBrandConfig(config: unknown): TaxJurisdiction[] {
  const root = asRecord(config);
  const tax = asRecord(root?.tax);
  const raw = tax?.jurisdictions;
  if (!Array.isArray(raw)) return [];
  const jurisdictions: TaxJurisdiction[] = [];
  const seen = new Set<string>();
  for (const candidate of raw) {
    const entry = asRecord(candidate);
    if (!entry) continue;
    const id = typeof entry.id === 'string' ? entry.id.trim() : '';
    const label = typeof entry.label === 'string' ? entry.label.trim() : '';
    const rate = entry.rate;
    // A rate above 1 is a percentage someone forgot to divide; charging it
    // would be a 290% tax line. Refuse rather than guess what was meant.
    if (!id || !label || seen.has(id)) continue;
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0 || rate > 1) continue;
    seen.add(id);
    jurisdictions.push({ id, label, rate });
  }
  return jurisdictions;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
