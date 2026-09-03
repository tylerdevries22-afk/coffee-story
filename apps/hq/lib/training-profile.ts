import { slugify, type TenantTrainingProfile } from '@platform/domain';

/**
 * Looser than the catalog's URL guard on purpose: this one also runs against
 * a tenant's own marketing site, which is frequently on a host the stricter
 * private-range regex would not reject anyway. Both refuse loopback and the
 * three private IPv4 ranges, which is the part that matters server-side.
 */
export function isSafePublicHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password) return false;
    if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return false;
    if (/^(?:10|127|169\.254|192\.168)\./.test(host)) return false;
    const private172 = /^172\.(\d{1,3})\./.exec(host);
    if (private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31) return false;
    return host.length > 3;
  } catch {
    return false;
  }
}

function cleanList(values: string[] | undefined): string[] | undefined {
  if (!values) return undefined;
  const unique = [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
  return unique.length > 0 ? unique : undefined;
}

export function normalizeTrainingProfile(profile: TenantTrainingProfile): TenantTrainingProfile {
  const normalized: TenantTrainingProfile = {
    businessName: profile.businessName.trim(),
    industry: profile.industry.trim(),
    locale: profile.locale.trim() || 'en-US',
  };
  const templateKey = profile.templateKey?.trim();
  if (templateKey) normalized.templateKey = templateKey;
  if (Number.isInteger(profile.templateVersion) && (profile.templateVersion ?? 0) > 0) normalized.templateVersion = profile.templateVersion;
  const website = profile.website?.trim();
  if (website) normalized.website = website;
  const products = cleanList(profile.products);
  if (products) normalized.products = products;
  const services = cleanList(profile.services);
  if (services) normalized.services = services;
  const complianceTopics = cleanList(profile.complianceTopics);
  if (complianceTopics) normalized.complianceTopics = complianceTopics;
  const brandVoice = profile.brandVoice?.trim();
  if (brandVoice) normalized.brandVoice = brandVoice;
  return normalized;
}

/** The shape a stored template key has to hold, for both writers below. */
const TEMPLATE_KEY = /^[a-z0-9][a-z0-9-]{1,79}$/;

export function validateTrainingProfile(profile: TenantTrainingProfile): string[] {
  const issues: string[] = [];
  if (profile.businessName.trim().length < 2) issues.push('businessName must contain at least 2 characters');
  if (profile.industry.trim().length < 2) issues.push('industry must contain at least 2 characters');
  if (!/^[a-z]{2}(?:-[A-Z]{2})?$/.test(profile.locale.trim())) issues.push('locale must resemble en or en-US');
  if (profile.website && !isSafePublicHttpsUrl(profile.website.trim())) issues.push('website must use public HTTPS');
  if (profile.templateKey && !TEMPLATE_KEY.test(profile.templateKey)) issues.push('templateKey must use lowercase letters, numbers, and single hyphens');
  if (profile.templateVersion !== undefined && (!Number.isInteger(profile.templateVersion) || profile.templateVersion < 1)) issues.push('templateVersion must be a positive integer');
  return issues;
}

export function trainingProfileFromBrandConfig(config: unknown): TenantTrainingProfile | null {
  if (!config || typeof config !== 'object') return null;
  const training = (config as { training?: unknown }).training;
  if (!training || typeof training !== 'object') return null;
  const profile = (training as { profile?: unknown }).profile;
  if (!profile || typeof profile !== 'object') return null;
  const source = profile as Record<string, unknown>;
  if (typeof source.businessName !== 'string' || typeof source.industry !== 'string' || typeof source.locale !== 'string') return null;
  const candidate = normalizeTrainingProfile(source as TenantTrainingProfile);
  return validateTrainingProfile(candidate).length === 0 ? candidate : null;
}

export function resolveTenantTrainingProfile(businessName: string, config: unknown): TenantTrainingProfile {
  const configured = trainingProfileFromBrandConfig(config);
  if (configured) return configured;
  const trainingConfig = config && typeof config === 'object' ? (config as { business?: unknown }).business : null;
  const fields = trainingConfig && typeof trainingConfig === 'object' ? trainingConfig as Record<string, unknown> : {};
  const website = typeof fields.website === 'string' && isSafePublicHttpsUrl(fields.website) ? fields.website : undefined;
  const industry = typeof fields.industry === 'string' && fields.industry.trim().length >= 2
    ? fields.industry.trim()
    : 'Business operations and customer service';
  const locale = typeof fields.locale === 'string' && /^[a-z]{2}(?:-[A-Z]{2})?$/.test(fields.locale) ? fields.locale : 'en-US';
  // Every tenant gets a template key of its own, derived the same way. This
  // used to name one shop outright -- so the first tenant reused its published
  // template and every tenant after it silently regenerated from scratch.
  // Guarded against the same shape validateTrainingProfile enforces, so a
  // name that slugs to something too short cannot produce a profile that fails
  // its own validator.
  const derived = slugify(businessName, 80);
  const templateKey = TEMPLATE_KEY.test(derived) ? derived : undefined;
  return normalizeTrainingProfile({ businessName, industry, locale, website, templateKey });
}
