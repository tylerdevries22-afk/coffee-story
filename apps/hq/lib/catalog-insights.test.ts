import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { starterTrainingManifest, type ContentCategory, type ContentMenuItem } from './content-model';
import {
  buildCatalogAssociationIndex,
  buildCatalogItemAssociations,
  catalogPath,
  catalogValidationSummary,
  displayPriceCents,
} from './catalog-insights';

const category: ContentCategory = {
  id: 'coffee', title: 'Coffee', tagline: '', slug: 'coffee', parentId: null,
  imageUrl: 'https://example.com/folder.jpg', audience: 'public', archived: false,
  sortOrder: 0, mediaVersions: [],
};
const item: ContentMenuItem = {
  id: 'espresso-id', name: 'Espresso', slug: 'espresso', description: 'Classic shot',
  categoryId: 'coffee', basePriceCents: 500, sizes: [{ slug: 'single', label: 'Single', priceCents: 400 }],
  optionGroups: [], imageUrl: 'https://example.com/espresso.jpg', audience: 'public',
  isListed: true, is86d: false, sortOrder: 0, updatedAt: null, mediaVersions: [],
};

describe('catalog insights', () => {
  it('resolves paths and the lowest displayed price', () => {
    assert.equal(catalogPath([category], category.id), 'Coffee');
    assert.equal(displayPriceCents(item), 400);
  });

  it('collects graph, alias, and training associations without inventing data', () => {
    const training = starterTrainingManifest({ businessName: 'Coffee Story', industry: 'Coffee', locale: 'en-US' });
    training.modules[0]!.lessons = [{
      slug: 'menu', title: 'Menu fluency', objective: 'Explain espresso', content: 'Explain espresso safely.',
      estimatedMinutes: 6, sourceUrls: [], menuItemSlugs: ['espresso'], media: [], quiz: [],
    }];
    const recipe = {
      id: 'recipe-id', kind: 'recipe' as const, slug: 'espresso-recipe', title: 'Espresso recipe',
      summary: 'Approved extraction.', audience: 'staff' as const, externalRef: null,
      imageUrl: null, mediaVersions: [],
    };
    const result = buildCatalogItemAssociations(
      item,
      [category],
      [recipe],
      [{ id: 'relation', sourceId: item.id, targetId: recipe.id, kind: 'requires' }],
      [{ id: 'alias', nodeId: item.id, parentId: category.id, sortOrder: 0, isPrimary: false }],
      training,
    );
    assert.equal(result.resources[0]?.resource.title, 'Espresso recipe');
    assert.equal(result.training[0]?.lessonTitle, 'Menu fluency');
    assert.deepEqual(result.aliases, ['Coffee']);
    assert.deepEqual(
      buildCatalogAssociationIndex([item], [category], [recipe], [], [], training).get(item.id)?.training,
      result.training,
    );
  });

  it('reports broken hierarchy and graph references while deduplicating warnings', () => {
    const broken = { ...category, parentId: 'missing', imageUrl: null };
    const summary = catalogValidationSummary(
      [broken],
      [{ ...item, categoryId: 'missing', imageUrl: null }],
      [],
      [{ id: 'broken', sourceId: 'unknown', targetId: 'also-unknown', kind: 'related' }],
    );
    assert.equal(summary.errors.length, 4);
    assert.deepEqual(summary.warnings, ['Coffee: add a folder thumbnail.', 'Espresso: add an offering thumbnail.']);
  });
});
