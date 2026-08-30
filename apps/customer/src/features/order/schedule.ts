/**
 * This binary's pickup schedule.
 *
 * The schedule itself is shared engine (`@platform/domain`), so the operator
 * app and the tests reach the same windows and the same close times. What
 * stays here is the one thing that cannot be shared: which week to honour.
 * It comes from the brand config compiled into this build, so a tenant open
 * 6am–2pm is never sold an 11pm slot -- which is exactly what the hardcoded
 * table this replaced would have done.
 *
 * Resolved once at module load: brand.json is bundled, so there is nothing
 * for a render to react to.
 */
import { pickupSchedule, resolveWeekHours } from '@platform/domain';

import { TENANT_BRAND_CONFIG } from '@/tenant';

export const { hoursForDay, pickupWindows, shopStatus } = pickupSchedule(
  resolveWeekHours(TENANT_BRAND_CONFIG),
);
