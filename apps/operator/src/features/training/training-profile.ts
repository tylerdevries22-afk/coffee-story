import type { TenantTrainingProfile } from '@platform/domain';

import { BUSINESS } from '@/data/business';

export const DEMO_TRAINING_PROFILE: TenantTrainingProfile = {
  businessName: BUSINESS.name,
  industry: 'Specialty coffee shop and café',
  locale: 'en-US',
  templateKey: BUSINESS.slug,
};

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

/** Resolves training identity only from explicit tenant configuration. */
export function trainingProfileFromBrandConfig(
  brandConfig: unknown,
  businessName: string | null | undefined,
  fallback: TenantTrainingProfile = DEMO_TRAINING_PROFILE,
): TenantTrainingProfile {
  const config = record(brandConfig);
  const business = record(config.business);
  const identity = record(config.identity);
  return {
    businessName: text(businessName) ?? fallback.businessName,
    industry: text(business.industry) ?? fallback.industry,
    locale: fallback.locale,
    templateKey: text(identity.slug) ?? fallback.templateKey,
  };
}
