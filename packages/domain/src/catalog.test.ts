import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  catalogBreadcrumbs,
  resolveCatalogVocabulary,
  validateCatalogManifest,
  type CatalogManifest,
} from './catalog';

function manifest(): CatalogManifest {
  return {
    schemaVersion: 1, catalogId: 'catalog', brandId: 'brand', version: 1,
    vocabulary: resolveCatalogVocabulary({ offering: 'Menu item' }), publishedAt: null,
    nodes: [
      { id: 'drinks', kind: 'folder', slug: 'drinks', title: 'Drinks', description: '', imageUrl: null, audience: 'public', archived: false },
      { id: 'coffee', kind: 'folder', slug: 'coffee', title: 'Coffee', description: '', imageUrl: null, audience: 'public', archived: false },
      { id: 'latte', kind: 'offering', slug: 'latte', title: 'Latte', description: '', imageUrl: null, audience: 'public', archived: false, commerceItemId: 'latte', commerce: { basePriceCents: 500, sizes: [], optionGroups: [], availability: {}, isListed: true } },
    ],
    placements: [
      { id: 'p1', parentId: null, nodeId: 'drinks', sortOrder: 10, isPrimary: true },
      { id: 'p2', parentId: 'drinks', nodeId: 'coffee', sortOrder: 10, isPrimary: true },
      { id: 'p3', parentId: 'coffee', nodeId: 'latte', sortOrder: 10, isPrimary: true },
    ], resources: [], relations: [],
  };
}

describe('catalog contracts', () => {
  it('resolves tenant vocabulary over template defaults', () => {
    assert.equal(resolveCatalogVocabulary({ offering: 'Product' }, { offering: 'Service' }).offering, 'Service');
  });

  it('validates a hierarchy and returns breadcrumbs', () => {
    const value = manifest();
    assert.deepEqual(validateCatalogManifest(value), []);
    assert.deepEqual(catalogBreadcrumbs(value, 'latte').map((node) => node.title), ['Drinks', 'Coffee', 'Latte']);
  });

  it('rejects duplicate sibling slugs and missing primary placements', () => {
    const value = manifest();
    value.nodes.push({ ...value.nodes[1]!, id: 'coffee-2' });
    value.placements.push({ id: 'p4', parentId: 'drinks', nodeId: 'coffee-2', sortOrder: 20, isPrimary: false });
    const codes = validateCatalogManifest(value).map((issue) => issue.code);
    assert.ok(codes.includes('duplicate_slug'));
    assert.ok(codes.includes('primary_placement'));
  });

  it('rejects cycles and invalid resource relations', () => {
    const value = manifest();
    value.placements[0] = { ...value.placements[0]!, parentId: 'coffee' };
    value.relations.push({ id: 'bad', sourceId: 'latte', targetId: 'missing', kind: 'requires' });
    const codes = validateCatalogManifest(value).map((issue) => issue.code);
    assert.ok(codes.includes('cycle'));
    assert.ok(codes.includes('invalid_relation'));
  });
});
