import { TENANT } from '@/tenant';

import { homeIndustryPack } from './home-industry-copy';

const PACK = homeIndustryPack(TENANT.business.industryKey);

/**
 * Kept for the screens that still ask "is this a project business", but derived
 * from the declared industry rather than from whether a copy key happens to be
 * set. It answers only about construction now: everything that used to read its
 * false branch as "therefore a coffee shop" reads the resolved pack instead.
 */
export const IS_PROJECT_BUSINESS = TENANT.business.industryKey === 'construction';

export const ACTION_LABEL = TENANT.copy.orderCta || 'Start an order';
export const ACTION_DETAIL = PACK.actionDetail;

export const HOME_PACKAGES = PACK.packages;

const city = TENANT.location.address.city || PACK.cityFallback;

export const HOME_COPY = PACK.copy(TENANT.identity.name, city);
