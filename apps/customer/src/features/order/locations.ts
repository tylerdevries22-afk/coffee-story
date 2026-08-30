/**
 * The shops this binary offers for pickup, and the blank delivery form.
 *
 * Both used to be frozen constants in the shared engine holding one brand's
 * street address and state, which every tenant built on this platform would
 * have shipped. They are derived from the brand config compiled into this
 * build instead -- the same source the schedule reads, so a card and its
 * opening hours cannot disagree.
 *
 * Resolved once at module load: brand.json is bundled, so there is nothing
 * for a render to react to.
 */
import { emptyDeliveryAddress, resolvePickupLocations } from '@platform/domain';

import { TENANT_BRAND_CONFIG } from '@/tenant';

export const PICKUP_LOCATIONS = resolvePickupLocations(TENANT_BRAND_CONFIG);

export const EMPTY_DELIVERY_ADDRESS = emptyDeliveryAddress(TENANT_BRAND_CONFIG);
