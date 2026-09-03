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

test('a blank-slate org carries no tokens, no copy, and no capability blob', () => {
  const result = parseOrgDraft({ name: 'Harbor Bakery' });
  assert.ok(result.ok);
  // Neutral defaults come from the theme resolver, never baked in here.
  assert.equal('tokens' in result.draft.brandConfig, false);
  assert.equal('copy' in result.draft.brandConfig, false);
  // What a new organization may run is decided by installing modules, not by
  // a blob the settings writers no longer accept.
  assert.equal('features' in result.draft.brandConfig, false);
  assert.deepEqual(Object.keys(result.draft.brandConfig), ['identity']);
});

test('an empty name is rejected', () => {
  assert.equal(parseOrgDraft({ name: '   ' }).ok, false);
});

test('a name with no alphanumerics is rejected', () => {
  assert.equal(parseOrgDraft({ name: '—•—' }).ok, false);
});

test('a one-character handle is rejected by the parser, not the database', () => {
  assert.equal(parseOrgDraft({ name: 'A' }).ok, false);
});

test('a long name produces a database-safe 63-character handle', () => {
  const result = parseOrgDraft({ name: 'A'.repeat(80) });
  assert.ok(result.ok);
  assert.equal(result.draft.slug.length, 63);
});
