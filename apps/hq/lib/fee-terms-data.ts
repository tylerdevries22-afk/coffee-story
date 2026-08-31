import { serverEnv, serviceDb } from './api-auth';
import { type FeeTerms, readPlatformFeeTerms } from './franchise-fees';
import { selectedOrgId } from './workspace-location';

const DEMO_TERMS: FeeTerms = {
  brand: { feeBps: 300, feeBpsTier2: 150, tierThresholdCents: 2_000_000 },
  locations: [],
};

export async function loadFeeTerms(actorId?: string): Promise<FeeTerms> {
  const environment = serverEnv();
  const brandId = await selectedOrgId();
  if (!environment || !actorId || !brandId) return DEMO_TERMS;
  const terms = await readPlatformFeeTerms(serviceDb(environment), actorId, brandId);
  if (!terms) throw new Error('Fee terms could not be loaded.');
  return terms;
}
