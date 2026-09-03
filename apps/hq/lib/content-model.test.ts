import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  contentCounts,
  isMenuItemDraft,
  parseTrainingDraftPayload,
  imageExtensionFor,
  restoreTrainingAnswers,
  slugFromLabel,
  starterTrainingManifest,
  validateTrainingDraft,
  validateMenuItemDraft,
  type ContentWorkspaceData,
} from './content-model';

const PROFILE = { businessName: 'Coffee Story', industry: 'Coffee', locale: 'en-US' };

describe('HQ content contracts', () => {
  it('creates portable menu slugs', () => {
    assert.equal(slugFromLabel('  Café Mocha + Cream  '), 'cafe-mocha-cream');
    assert.equal(slugFromLabel('---'), '');
  });

  it('accepts image bytes only when their declared format matches', () => {
    assert.equal(imageExtensionFor('image/jpeg', Uint8Array.from([0xff, 0xd8, 0xff, 0x00])), 'jpg');
    assert.equal(imageExtensionFor('image/png', Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'png');
    assert.equal(imageExtensionFor('image/jpeg', new TextEncoder().encode('<html>')), null);
  });

  it('validates tenant menu input at the action boundary', () => {
    const issues = validateMenuItemDraft({
      id: 'item', name: 'A', slug: 'Bad Slug', description: 'x'.repeat(601),
      categoryId: 'foreign', basePriceCents: -1, imageUrl: null, audience: 'public',
      sizes: [], optionGroups: [],
      isListed: true, is86d: false, sortOrder: -1,
    }, new Set(['own']));
    assert.equal(issues.length, 6);
    assert.equal(isMenuItemDraft(null), false);
    assert.equal(isMenuItemDraft({ name: 'Only a name' }), false);
  });

  it('accepts storefront sizes and conditional modifiers and rejects broken references', () => {
    const draft = {
      id: null, name: 'Latte', slug: 'latte', description: 'Espresso and milk',
      categoryId: 'coffee', basePriceCents: 400,
      sizes: [{ slug: '12', label: '12 oz', priceCents: 400 }],
      optionGroups: [
        { id: 'serve', name: 'Serve', select: 'single' as const, required: true, maxChoices: 1, choices: [{ id: 'iced', name: 'Iced', priceDeltaCents: 0 }] },
        { id: 'ice', name: 'Ice', select: 'single' as const, required: true, maxChoices: 1, dependsOn: { groupId: 'serve', choiceIds: ['iced'] }, choices: [{ id: 'regular-ice', name: 'Regular', priceDeltaCents: 0 }] },
      ],
      imageUrl: null, audience: 'public' as const, isListed: true, is86d: false, sortOrder: 0,
    };
    assert.equal(isMenuItemDraft(draft), true);
    assert.deepEqual(validateMenuItemDraft(draft, new Set(['coffee'])), []);
    draft.optionGroups[1]!.dependsOn = { groupId: 'missing', choiceIds: ['iced'] };
    assert.match(validateMenuItemDraft(draft, new Set(['coffee'])).join(' '), /earlier group/);
  });

  it('rejects menu image URLs beyond the persisted limit', () => {
    const draft = {
      id: 'item', name: 'One', slug: 'one', description: '', categoryId: 'coffee',
      basePriceCents: 100, sizes: [], optionGroups: [],
      imageUrl: `https://example.com/${'a'.repeat(2_100)}`,
      audience: 'public' as const,
      isListed: true, is86d: false, sortOrder: 0,
    };
    assert.deepEqual(validateMenuItemDraft(draft, new Set(['coffee'])), [
      'Image URL must use public HTTPS and be at most 2,048 characters.',
    ]);
  });

  it('restores private answers into the owner authoring copy only', () => {
    const manifest = starterTrainingManifest(PROFILE);
    manifest.modules[0]!.lessons = [{
      slug: 'coffee-basics', title: 'Coffee basics', objective: 'Recognize the core menu',
      content: 'A'.repeat(90), estimatedMinutes: 5, sourceUrls: [], media: [],
      quiz: [{ prompt: 'Which?', choices: ['A', 'B'], explanation: 'A is taught.' }],
    }];
    const restored = restoreTrainingAnswers(manifest, { knowledge: { 'coffee-basics': [0] } });
    assert.equal(restored.modules[0]!.lessons[0]!.quiz[0]!.correctChoice, 0);
    assert.equal(manifest.modules[0]!.lessons[0]!.quiz[0]!.correctChoice, undefined);
  });

  it('starts every empty tenant with all transferable core tracks', () => {
    const manifest = starterTrainingManifest(PROFILE);
    assert.deepEqual(manifest.modules.map((module) => module.slug), ['knowledge', 'skills', 'service', 'safety', 'operations']);
    assert.equal(manifest.tenant.businessName, 'Coffee Story');
  });

  it('allows incomplete drafts while bounding their shape', () => {
    const manifest = starterTrainingManifest(PROFILE);
    assert.notEqual(parseTrainingDraftPayload(manifest), null);
    assert.equal(parseTrainingDraftPayload({ schemaVersion: 1, tenant: {}, sources: [], modules: [{}] }), null);
    assert.deepEqual(validateTrainingDraft(manifest), []);
    manifest.modules[0]!.slug = 'Bad Slug';
    assert.match(validateTrainingDraft(manifest)[0] ?? '', /valid slug/);
  });

  it('counts all managed media and lessons', () => {
    const manifest = starterTrainingManifest(PROFILE);
    manifest.modules[0]!.lessons = [{
      slug: 'one', title: 'One', objective: 'One', content: 'A'.repeat(90), estimatedMinutes: 3,
      sourceUrls: [], quiz: [], media: [{ kind: 'video', url: 'https://example.com/v', title: 'Video', rightsNote: 'Publisher hosted resource' }],
    }];
    const data = {
      menu: { id: 'menu', name: 'Catalog', isPublished: true, draftVersion: 1, publishedVersion: 1, updatedAt: null },
      categories: [],
      items: [{ id: 'one', name: 'One', slug: 'one', description: '', categoryId: 'cat', basePriceCents: 100, sizes: [], optionGroups: [], imageUrl: 'https://example.com/i', audience: 'public', isListed: true, is86d: false, sortOrder: 0, updatedAt: null, mediaVersions: [] }],
      catalogResources: [],
      catalogRelations: [],
      catalogPlacements: [],
      training: { id: null, version: 0, status: 'empty', manifest, updatedAt: null },
      trainingMediaVersions: [],
      trainingProfile: PROFILE,
      automationRun: null,
    } satisfies ContentWorkspaceData;
    assert.deepEqual(contentCounts(data), { listedItems: 1, lessons: 1, media: 2 });
  });
});
