import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { CatalogManifest } from '@platform/domain';

import { fetchPublishedCatalog, subscribeToCatalogPublication } from './catalog';

const manifest: CatalogManifest = {
  schemaVersion: 1, catalogId: 'catalog-1', brandId: 'brand-1', version: 2,
  vocabulary: { catalog: 'Catalog', folder: 'Category', offering: 'Menu item', material: 'Ingredient', procedure: 'Recipe' },
  nodes: [{ id: 'folder-1', kind: 'folder', slug: 'coffee', title: 'Coffee', description: '', imageUrl: null, audience: 'public', archived: false }],
  placements: [{ id: 'placement-1', parentId: null, nodeId: 'folder-1', sortOrder: 10, isPrimary: true }],
  resources: [], relations: [], publishedAt: '2026-08-27T00:00:00.000Z',
};

function clientForCatalog() {
  const removed: unknown[] = [];
  const channel = { on() { return channel; }, subscribe(callback?: (status: string) => void) { callback?.('SUBSCRIBED'); return channel; } };
  const release = {
    id: 'release-1', brand_id: 'brand-1', version: 2, status: 'published', manifest,
    created_at: '2026-08-27T00:00:00.000Z', published_at: '2026-08-27T00:00:00.000Z',
  };
  const resolving = (rows: unknown[]) => {
    const builder = {
      select() { return builder; }, eq() { return builder; }, limit() { return builder; }, abortSignal() { return builder; }, returns() { return builder; },
      maybeSingle() { return { then(resolve: (value: { data: unknown; error: null }) => void) { resolve({ data: rows[0] ?? null, error: null }); } }; },
      then(resolve: (value: { data: unknown[]; error: null }) => void) { resolve({ data: rows, error: null }); },
    };
    return builder;
  };
  const client = {
    from(table: string) {
      return resolving(table === 'catalog_publications'
        ? [{ release_id: 'release-1', version: 2, published_at: '2026-08-27T00:00:00.000Z' }]
        : [{ release_id: 'release-1', brand_id: 'brand-1', manifest }]);
    },
    // The guest read is an RPC, not a table: the anon grant on catalog_releases
    // returned every brand's manifest and 0903230000 took it back.
    rpc(name: string, args: { p_brand_id: string }) {
      return resolving(name === 'published_catalog_lookup' && args.p_brand_id === 'brand-1' ? [release] : []);
    },
    channel() { return channel; },
    removeChannel(value: unknown) { removed.push(value); return Promise.resolve('ok'); },
  } as unknown as SupabaseClient;
  return { client, removed };
}

describe('published catalog data', () => {
  it('loads and validates the active immutable release', async () => {
    const { client } = clientForCatalog();
    const release = await fetchPublishedCatalog(client, 'brand-1');
    assert.equal(release?.version, 2);
    assert.equal(release?.manifest.nodes[0]?.title, 'Coffee');
  });

  it('refetches at the realtime subscription boundary and cleans up', async () => {
    const { client, removed } = clientForCatalog();
    let changes = 0;
    const stop = subscribeToCatalogPublication(client, 'brand-1', () => { changes += 1; }, 5);
    await new Promise((resolve) => setTimeout(resolve, 15));
    stop();
    assert.equal(changes, 1);
    assert.equal(removed.length, 1);
  });
});
