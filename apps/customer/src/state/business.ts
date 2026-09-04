import { BUSINESS_DETAILS, type BusinessDetails } from '@/data/business';

/**
 * The shop this app belongs to.
 *
 * One binary per brand (rule 7), so the answer is fixed at build time from
 * the applied `src/tenants/<slug>/brand.json`. The staff app answers the same question from the
 * signed-in brand row, which is why this is a hook in both apps and not a
 * constant the shared components import directly.
 */
export function useBusiness(): BusinessDetails {
  return BUSINESS_DETAILS;
}
