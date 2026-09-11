import { taxJurisdictionsFromBrandConfig, type TaxJurisdiction } from '@platform/domain';

/**
 * The signed-in brand's tax authorities.
 *
 * Held the way `currentBusiness()` is, and for the same reason: this app is one
 * listing tenanted by login, so its shop -- and its tax -- is a runtime answer.
 * Empty until a brand row lands, which shows no tax rather than another shop's.
 * The server recomputes every cent regardless, so this only drives display.
 */
let taxJurisdictions: readonly TaxJurisdiction[] = [];

export function setCurrentTaxJurisdictions(config: unknown): void {
  taxJurisdictions = taxJurisdictionsFromBrandConfig(config);
}

export function currentTaxJurisdictions(): readonly TaxJurisdiction[] {
  return taxJurisdictions;
}
