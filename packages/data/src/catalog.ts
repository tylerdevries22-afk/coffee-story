import type { SupabaseClient } from '@supabase/supabase-js';

import {
  validateCatalogManifest,
  type CatalogAudience,
  type CatalogManifest,
  type CatalogRelease,
} from '@platform/domain';

import { readWithRetry } from './read-retry';

type ReleaseRow = {
  id: string;
  brand_id: string;
  version: number;
  status: 'published';
  manifest: CatalogManifest;
  created_at: string;
  published_at: string | null;
};

type PublicationRow = { release_id: string; version: number; published_at: string };

const CATALOG_CACHE = new Map<string, CatalogRelease>();

function releaseOf(row: ReleaseRow): CatalogRelease {
  if (validateCatalogManifest(row.manifest).length > 0) throw new Error('Published catalog failed validation.');
  return {
    id: row.id, brandId: row.brand_id, version: row.version, status: row.status,
    manifest: row.manifest, createdAt: row.created_at, publishedAt: row.published_at,
  };
}

/**
 * The guest read. Goes through the lookup rather than `catalog_releases`
 * because the table's anon grant returned every brand's published manifest to
 * any holder of the publishable key (0903230000); the argument is the
 * boundary, and naming no brand returns nothing.
 */
async function loadPublicCatalog(
  client: SupabaseClient,
  brandId: string,
): Promise<CatalogRelease | null> {
  const row = await readWithRetry('fetchPublishedCatalog', (signal) => client
    .rpc('published_catalog_lookup', { p_brand_id: brandId })
    .abortSignal(signal).maybeSingle<ReleaseRow>());
  return row ? releaseOf(row) : null;
}

/** The staff read: the same release, projected for a brand's own people. */
async function loadStaffCatalog(
  client: SupabaseClient,
  brandId: string,
): Promise<CatalogRelease | null> {
  const publications = await readWithRetry('fetchCatalogPublication', (signal) => client
    .from('catalog_publications').select('release_id, version, published_at')
    .eq('brand_id', brandId).limit(1).abortSignal(signal).returns<PublicationRow[]>());
  const publication = publications?.[0];
  if (!publication) return null;
  const rows = await readWithRetry('fetchPublishedCatalog', (signal) => client
    .from('catalog_release_private').select('release_id, brand_id, manifest')
    .eq('release_id', publication.release_id)
    .limit(1).abortSignal(signal).returns<Record<string, unknown>[]>());
  const raw = rows?.[0];
  if (!raw) return null;
  return releaseOf({
    id: String(raw.release_id), brand_id: String(raw.brand_id), version: publication.version,
    status: 'published', manifest: raw.manifest as CatalogManifest,
    created_at: publication.published_at, published_at: publication.published_at,
  });
}

async function loadPublishedCatalog(
  client: SupabaseClient,
  brandId: string,
  audience: CatalogAudience = 'public',
): Promise<CatalogRelease | null> {
  return audience === 'public'
    ? loadPublicCatalog(client, brandId)
    : loadStaffCatalog(client, brandId);
}

export async function fetchPublishedCatalog(
  client: SupabaseClient,
  brandId: string,
  audience: CatalogAudience = 'public',
): Promise<CatalogRelease | null> {
  const cacheKey = `${brandId}:${audience}`;
  try {
    const release = await loadPublishedCatalog(client, brandId, audience);
    if (release) CATALOG_CACHE.set(cacheKey, release);
    return release ?? CATALOG_CACHE.get(cacheKey) ?? null;
  } catch {
    return CATALOG_CACHE.get(cacheKey) ?? null;
  }
}

export function subscribeToCatalogPublication(
  client: SupabaseClient | null,
  brandId: string,
  onChanged: () => void,
  settleMs = 200,
): () => void {
  if (!client) return () => {};
  let timer: ReturnType<typeof setTimeout> | null = null;
  let live = true;
  const settle = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { if (live) onChanged(); }, settleMs);
  };
  const channel = client.channel(`catalog-publication-${brandId}`)
    .on('postgres_changes', {
      event: '*', schema: 'public', table: 'catalog_publications', filter: `brand_id=eq.${brandId}`,
    }, settle)
    .subscribe((status) => { if (status === 'SUBSCRIBED') settle(); });
  return () => {
    live = false;
    if (timer) clearTimeout(timer);
    void client.removeChannel(channel);
  };
}
