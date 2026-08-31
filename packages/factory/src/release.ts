export const RELEASE_CHECKS = [
  'productionCredentials',
  'providerAccounts',
  'legalAndPrivacy',
  'storeListings',
  'commercialConfiguration',
] as const;

type ReleaseCheck = {
  status: 'approved' | 'pending';
  approvedAt?: string;
  approvedBy?: string;
  evidenceUrl?: string;
};

export type TenantReleaseManifest = {
  schemaVersion: 1;
  tenantSlug: string;
  expoGo: { appStoreSdk: number; checkedAt: string; sourceUrl: string };
  checks: Record<(typeof RELEASE_CHECKS)[number], ReleaseCheck>;
};

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function evidenceUrl(value: unknown): boolean {
  if (typeof value !== 'string' || value.length > 500) return false;
  try { return new URL(value).protocol === 'https:'; } catch { return false; }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function releaseManifestIssues(
  value: unknown,
  expectedTenant: string,
  now = new Date(),
): string[] {
  const manifest = record(value);
  if (!manifest) return ['Release manifest must be a JSON object.'];
  const issues: string[] = [];
  if (manifest.schemaVersion !== 1) issues.push('Release manifest schemaVersion must be 1.');
  if (manifest.tenantSlug !== expectedTenant || !SLUG.test(expectedTenant)) {
    issues.push('Release manifest tenantSlug must match the requested tenant.');
  }
  const expoGo = record(manifest.expoGo);
  const checkedAt = typeof expoGo?.checkedAt === 'string' ? new Date(expoGo.checkedAt) : null;
  const age = checkedAt ? now.getTime() - checkedAt.getTime() : Number.POSITIVE_INFINITY;
  if (expoGo?.appStoreSdk !== 54) issues.push('The App Store Expo Go SDK must be re-confirmed as 54 for this pinned repository.');
  if (!checkedAt || Number.isNaN(checkedAt.getTime()) || age < 0 || age > 45 * 86_400_000) {
    issues.push('The App Store Expo Go SDK check must be dated within 45 days of release.');
  }
  if (typeof expoGo?.sourceUrl !== 'string'
    || !expoGo.sourceUrl.startsWith('https://docs.expo.dev/')) {
    issues.push('The Expo Go check must cite the official Expo documentation.');
  }
  const checks = record(manifest.checks);
  for (const key of RELEASE_CHECKS) {
    const check = record(checks?.[key]);
    if (check?.status !== 'approved') {
      issues.push(`${key} is not approved.`);
      continue;
    }
    const approvedAt = typeof check.approvedAt === 'string' ? Date.parse(check.approvedAt) : NaN;
    if (typeof check.approvedBy !== 'string' || check.approvedBy.trim().length < 2
      || Number.isNaN(approvedAt) || approvedAt > now.getTime()
      || !evidenceUrl(check.evidenceUrl)) {
      issues.push(`${key} approval needs approvedBy, approvedAt, and an HTTPS evidenceUrl.`);
    }
  }
  return issues;
}
