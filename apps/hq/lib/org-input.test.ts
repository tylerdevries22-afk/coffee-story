import assert from 'node:assert/strict';
import test from 'node:test';

import { parseOrgDraft } from './org-input';

test('a name becomes a slug and a blank-slate brand config', () => {
  const result = parseOrgDraft({ name: 'Harbor Bakery' });
  assert.ok(result.ok);
  assert.equal(result.draft.slug, 'harbor-bakery');
  assert.equal(result.draft.name, 'Harbor Bakery');
  assert.deepEqual(result.draft.brandConfig.identity, { slug: 'harbor-bakery', name: 'Harbor Bakery' });
});

test('a blank-slate org carries no tokens and no copy', () => {
  const result = parseOrgDraft({ name: 'Harbor Bakery' });
  assert.ok(result.ok);
  // Neutral defaults come from the theme resolver, never baked in here.
  assert.equal('tokens' in result.draft.brandConfig, false);
  assert.equal('copy' in result.draft.brandConfig, false);
  assert.equal(result.draft.brandConfig.features.multi_location, true);
  assert.equal(result.draft.brandConfig.features.drops, false);
});

test('an empty name is rejected', () => {
  assert.equal(parseOrgDraft({ name: '   ' }).ok, false);
});

test('a name with no alphanumerics is rejected', () => {
  assert.equal(parseOrgDraft({ name: '—•—' }).ok, false);
});
