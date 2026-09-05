import { database, saveArtifact } from './factory-runtime';

type PublishedRelease = {
  id: string;
  version: number;
  manifest: unknown;
};

export type FactoryContentSnapshot = {
  manifest: Record<string, unknown>;
};

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function factoryContentSnapshot(
  release: PublishedRelease | null,
  tenantSlug: string,
): FactoryContentSnapshot | null {
  const manifest = object(release?.manifest);
  if (!release || !Number.isInteger(release.version) || release.version < 1 || !manifest) return null;
  return {
    manifest: {
      tenantSlug,
      releaseId: release.id,
      releaseVersion: release.version,
      release: manifest,
    },
  };
}

export function nextContentArtifactVersion(
  latest: { version: number; manifest: unknown } | null,
  releaseId: string,
): number | null {
  if (object(latest?.manifest)?.releaseId === releaseId) return null;
  return (latest?.version ?? 0) + 1;
}

async function brandId(tenantSlug: string): Promise<string | null> {
  const result = await database().from('brands').select('id')
    .eq('slug', tenantSlug).in('status', ['provisioning', 'active']).maybeSingle();
  if (result.error) throw new Error(`Factory content brand lookup failed: ${result.error.code}`);
  return result.data?.id ?? null;
}

async function latestPublished(
  table: 'training_releases',
  targetBrandId: string,
): Promise<PublishedRelease | null> {
  const result = await database().from(table).select('id,version,manifest')
    .eq('brand_id', targetBrandId).eq('status', 'published')
    .order('version', { ascending: false }).limit(1).maybeSingle();
  if (result.error) throw new Error(`Factory ${table} lookup failed: ${result.error.code}`);
  return result.data as PublishedRelease | null;
}

async function publishedCatalog(targetBrandId: string): Promise<PublishedRelease | null> {
  const pointer = await database().from('catalog_publications').select('release_id')
    .eq('brand_id', targetBrandId).maybeSingle<{ release_id: string }>();
  if (pointer.error) throw new Error(`Factory catalog pointer lookup failed: ${pointer.error.code}`);
  if (!pointer.data) return null;
  const release = await database().from('catalog_releases').select('id,version,manifest')
    .eq('id', pointer.data.release_id).eq('brand_id', targetBrandId)
    .eq('status', 'published').maybeSingle();
  if (release.error) throw new Error(`Factory catalog release lookup failed: ${release.error.code}`);
  return release.data as PublishedRelease | null;
}

async function savePublished(
  runId: string,
  kind: 'catalog' | 'training',
  snapshot: FactoryContentSnapshot,
): Promise<void> {
  const releaseId = snapshot.manifest.releaseId;
  if (typeof releaseId !== 'string') throw new Error(`Factory ${kind} release identity is invalid.`);
  const prior = await database().from('platform_artifact_manifests')
    .select('version,manifest').eq('run_id', runId).eq('artifact_kind', kind)
    .order('version', { ascending: false }).limit(1).maybeSingle();
  if (prior.error) throw new Error(`Factory ${kind} artifact lookup failed: ${prior.error.code}`);
  const version = nextContentArtifactVersion(prior.data, releaseId);
  if (version !== null) await saveArtifact(runId, kind, snapshot.manifest, version);
}

/** Copies only authoritative published releases into the immutable factory ledger. */
export async function synchronizePublishedContent(
  runId: string,
  tenantSlug: string,
): Promise<boolean> {
  'use step';
  const targetBrandId = await brandId(tenantSlug);
  if (!targetBrandId) return false;
  const [catalog, training] = await Promise.all([
    publishedCatalog(targetBrandId),
    latestPublished('training_releases', targetBrandId),
  ]);
  const catalogSnapshot = factoryContentSnapshot(catalog, tenantSlug);
  const trainingSnapshot = factoryContentSnapshot(training, tenantSlug);
  if (!catalogSnapshot || !trainingSnapshot) return false;
  await Promise.all([
    savePublished(runId, 'catalog', catalogSnapshot),
    savePublished(runId, 'training', trainingSnapshot),
  ]);
  return true;
}
