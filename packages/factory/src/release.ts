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
  releaseId?: string;
  commitSha?: string;
  artifactDigest?: string;
};

export type TenantReleaseManifest = {
  schemaVersion: 2;
  tenantSlug: string;
  release: ReleaseBinding;
  expoGo: { appStoreSdk: number; checkedAt: string; sourceUrl: string };
  checks: Record<(typeof RELEASE_CHECKS)[number], ReleaseCheck>;
};

export type ReleaseBinding = {
  releaseId: string;
  commitSha: string;
  artifactDigest: string;
  createdAt: string;
};

export type ReleaseValidationContext = {
  now?: Date;
  expectedArtifactDigest?: string;
};

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RELEASE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/;
const COMMIT_SHA = /^[0-9a-f]{40}$/;
const ARTIFACT_DIGEST = /^sha256:[0-9a-f]{64}$/;

function evidenceUrl(value: unknown): boolean {
  if (typeof value !== 'string' || value.length > 500) return false;
  try { return new URL(value).protocol === 'https:'; } catch { return false; }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function releaseBinding(value: unknown): ReleaseBinding | null {
  const manifest = record(value);
  const release = record(manifest?.release);
  if (!release) return null;
  const { releaseId, commitSha, artifactDigest, createdAt } = release;
  return typeof releaseId === 'string' && typeof commitSha === 'string'
    && typeof artifactDigest === 'string' && typeof createdAt === 'string'
    ? { releaseId, commitSha, artifactDigest, createdAt }
    : null;
}

/**
 * The EAS project ids a tenant actually needs, given the surfaces it ships.
 *
 * A tenant that enables no customer app has no customer EAS project and never
 * will, so demanding one blocks it from ever releasing -- which is what
 * happened to the construction tenant, whose modules serve only `operator` and
 * `hq`. The check is per surface rather than universal.
 *
 * `surfaces` must come from a validated release plan that cross-checks the
 * tenant's declared deployable surfaces against its enabled module registry
 * requirements. That keeps the deployment matrix explicit without allowing a
 * tenant to shrink its way out of its own release gate.
 *
 * Fail-closed is the caller's job. When the surface set cannot be determined,
 * pass all of them and both ids stay required.
 */
export function easProjectIssues(identity: unknown, surfaces: Iterable<string>): string[] {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const shipped = new Set(surfaces);
  const fields = [
    { surface: 'customer', key: 'easProjectId', label: 'customer' },
    { surface: 'kiosk', key: 'kioskEasProjectId', label: 'kiosk' },
  ] as const;
  const block = record(identity);
  const issues: string[] = [];
  for (const field of fields) {
    if (!shipped.has(field.surface)) continue;
    const value = block?.[field.key];
    if (typeof value !== 'string' || !uuid.test(value)) {
      issues.push(`brand.json identity.${field.key} must be the tenant ${field.label} `
        + `EAS project UUID, because this tenant ships the ${field.surface} surface.`);
    }
  }
  return issues;
}

export function releaseManifestIssues(
  value: unknown,
  expectedTenant: string,
  input: Date | ReleaseValidationContext = {},
): string[] {
  const context = input instanceof Date ? { now: input } : input;
  const now = context.now ?? new Date();
  const manifest = record(value);
  if (!manifest) return ['Release manifest must be a JSON object.'];
  const issues: string[] = [];
  if (manifest.schemaVersion !== 2) issues.push('Release manifest schemaVersion must be 2.');
  if (manifest.tenantSlug !== expectedTenant || !SLUG.test(expectedTenant)) {
    issues.push('Release manifest tenantSlug must match the requested tenant.');
  }
  const release = record(manifest.release);
  const releaseId = typeof release?.releaseId === 'string' ? release.releaseId : '';
  const commitSha = typeof release?.commitSha === 'string' ? release.commitSha : '';
  const artifactDigest = typeof release?.artifactDigest === 'string' ? release.artifactDigest : '';
  const createdAt = typeof release?.createdAt === 'string' ? Date.parse(release.createdAt) : NaN;
  if (!RELEASE_ID.test(releaseId)) issues.push('Release evidence needs an immutable releaseId.');
  if (!COMMIT_SHA.test(commitSha)) issues.push('Release evidence needs a full lowercase Git commit SHA.');
  if (!ARTIFACT_DIGEST.test(artifactDigest)) issues.push('Release evidence needs a SHA-256 tenant artifact digest.');
  if (Number.isNaN(createdAt) || createdAt > now.getTime()) issues.push('Release evidence needs a valid createdAt that is not in the future.');
  if (context.expectedArtifactDigest && ARTIFACT_DIGEST.test(artifactDigest)
    && artifactDigest !== context.expectedArtifactDigest) {
    issues.push('Release evidence is stale: artifactDigest does not match the tenant artifact being deployed.');
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
    if (!Number.isNaN(createdAt) && !Number.isNaN(approvedAt) && approvedAt < createdAt) {
      issues.push(`${key} approval predates this immutable release.`);
    }
    if (check.releaseId !== releaseId || check.commitSha !== commitSha
      || check.artifactDigest !== artifactDigest) {
      issues.push(`${key} evidence is not bound to this release, commit, and artifact.`);
    }
  }
  return issues;
}
