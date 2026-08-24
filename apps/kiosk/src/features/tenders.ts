import type { KioskTender } from '@platform/domain';

export type TenderCapabilities = {
  allowsCash: boolean;
  hasBalanceLookup: boolean;
};

/**
 * A configured tender is an invitation to hand over money, so the kiosk only
 * renders one when this binary can complete its full path. Hidden is safer
 * than a decorative balance button that ends at a zero-valued stub.
 */
export function availableTenders(
  configured: readonly KioskTender[],
  capabilities: TenderCapabilities,
): readonly KioskTender[] {
  return configured.filter((tender) => {
    if (tender === 'cash') return capabilities.allowsCash;
    if (tender === 'gift_card' || tender === 'stored_value') {
      return capabilities.hasBalanceLookup;
    }
    return true;
  });
}
