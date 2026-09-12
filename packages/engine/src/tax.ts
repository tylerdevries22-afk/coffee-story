/**
 * Sales tax as the server computes it. The rate table is data (each brand
 * states its authorities in brand_config.tax.jurisdictions), never code, so
 * the platform carries no tenant's tax situation in a source file.
 *
 * Each authority's row is rounded on its own and the total is the sum of the
 * rows (CLAUDE.md money rule): the receipt's printed rows always equal the
 * total they sit above.
 */

// Imported as well as re-exported below: `export { type X } from` publishes the
// name without binding it here, and parseTaxJurisdictions annotates with it.
import type { TaxJurisdiction } from '@platform/domain';

/**
 * The computation itself lives in @platform/domain and is re-exported here.
 *
 * These were two byte-identical copies, which meant one rounding defect in two
 * places: the float form undercharged a cent whenever the exact tax landed on
 * a half. Re-exporting keeps `@platform/engine/tax` as the server's import
 * surface while there is only one implementation to be right. The brand_config
 * parser below stays local -- engine's and domain's have diverged, and
 * reconciling them is a separate change on the money path.
 */
export {
  taxCentsFor,
  taxRowsFor,
  type TaxJurisdiction,
  type TaxRow,
} from '@platform/domain';

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
