/**
 * This tenant's tax authorities.
 *
 * Read from the bundled brand file rather than defaulted in packages/domain --
 * a default there is what put "City of Aurora Sales Tax" on every other shop's
 * checkout screen. A tenant that declares none charges none on screen; the
 * server recomputes every cent from `brand_config` regardless, so this only
 * ever drives display.
 */
import { taxJurisdictionsFromBrandConfig, type TaxJurisdiction } from '@platform/domain';

import TENANT from './brand.json';

export const TENANT_TAX: readonly TaxJurisdiction[] = taxJurisdictionsFromBrandConfig(TENANT);
