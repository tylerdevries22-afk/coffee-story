import type { SafeResource } from './factory-runtime';

export type AdoptionResult = { resource: SafeResource; persist: boolean };

type GitHubExpectation = {
  repository: string;
  owner: string;
  templateRepository: string;
};

type VercelExpectation = {
  kind: string;
  name: string;
  repository: string;
  rootDirectory: string;
  scope: string;
};

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function sameName(left: string | null, right: string): boolean {
  return left?.toLowerCase() === right.toLowerCase();
}

function repositoryUrl(value: unknown, repository: string): string | null {
  const raw = text(value);
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    const path = parsed.pathname.replace(/\/$/, '').slice(1);
    return parsed.protocol === 'https:' && parsed.hostname === 'github.com'
      && !parsed.username && !parsed.password && !parsed.search && !parsed.hash
      && sameName(path, repository) ? raw : null;
  } catch {
    return null;
  }
}

function vercelRepositoryMatches(link: Record<string, unknown> | null, repository: string): boolean {
  if (link?.type !== 'github') return false;
  const [owner, name, extra] = repository.split('/');
  if (!owner || !name || extra) return false;
  const linked = text(link.repo);
  return (
    sameName(linked, repository) || (sameName(linked, name) && sameName(text(link.org), owner))
  );
}

function assertStored(
  stored: SafeResource,
  expected: SafeResource,
): void {
  const metadata = object(stored.metadata);
  const expectedMetadata = object(expected.metadata);
  const matches = stored.provider === expected.provider && stored.kind === expected.kind
    && stored.environment === 'production' && stored.externalId === expected.externalId
    && stored.displayName === expected.displayName && metadata && expectedMetadata
    && Object.entries(expectedMetadata).every(([key, value]) => metadata[key] === value);
  if (!matches) throw new Error(`Stored ${expected.provider} resource provenance does not match.`);
}

export async function verifyAdoption<T>(input: {
  stored: SafeResource | null;
  lookup: () => Promise<T | null>;
  create: () => Promise<T>;
  verify: (value: T, stored: SafeResource | null) => SafeResource;
}): Promise<AdoptionResult> {
  const found = await input.lookup();
  const existing = verifyExistingAdoption(input.stored, found, input.verify);
  if (existing) return existing;
  return { resource: input.verify(await input.create(), null), persist: true };
}

export function verifyExistingAdoption<T>(
  stored: SafeResource | null,
  found: T | null,
  verify: (value: T, stored: SafeResource | null) => SafeResource,
): AdoptionResult | null {
  if (stored && !found) {
    throw new Error('Stored provider resource no longer exists at the expected identity.');
  }
  return found ? { resource: verify(found, stored), persist: !stored } : null;
}

export function verifiedGitHubResource(
  value: unknown,
  expected: GitHubExpectation,
  stored: SafeResource | null,
): SafeResource {
  const payload = object(value);
  const owner = object(payload?.owner);
  const template = object(payload?.template_repository);
  const providerId = typeof payload?.id === 'number' && Number.isSafeInteger(payload.id)
    ? String(payload.id) : null;
  const url = repositoryUrl(payload?.html_url, expected.repository);
  if (!payload || !sameName(text(payload.full_name), expected.repository)
    || !sameName(text(owner?.login), expected.owner)
    || !sameName(text(template?.full_name), expected.templateRepository)
    || !providerId || !url) {
    throw new Error('GitHub repository provenance does not match the requested tenant template.');
  }
  const resource: SafeResource = {
    provider: 'github', kind: 'repository', environment: 'production',
    externalId: expected.repository, displayName: expected.repository,
    metadata: {
      url, providerId, owner: expected.owner, repository: expected.repository,
      templateRepository: expected.templateRepository,
    },
  };
  if (stored) assertStored(stored, resource);
  return resource;
}

export function verifiedVercelResource(
  value: unknown,
  expected: VercelExpectation,
  stored: SafeResource | null,
): SafeResource {
  const payload = object(value);
  const link = object(payload?.link);
  const providerId = text(payload?.id);
  const accountId = text(payload?.accountId);
  const scopeMatches = !expected.scope.startsWith('team_') || accountId === expected.scope;
  if (!payload || text(payload.name) !== expected.name || !providerId
    || text(payload.rootDirectory) !== expected.rootDirectory
    || !vercelRepositoryMatches(link, expected.repository)
    || !scopeMatches) {
    throw new Error('Vercel project provenance does not match the requested tenant surface.');
  }
  const resource: SafeResource = {
    provider: 'vercel', kind: expected.kind, environment: 'production',
    externalId: providerId, displayName: expected.name,
    metadata: {
      url: `https://${expected.name}.vercel.app`, providerId, scope: expected.scope,
      repository: expected.repository, rootDirectory: expected.rootDirectory,
    },
  };
  if (stored) assertStored(stored, resource);
  return resource;
}
