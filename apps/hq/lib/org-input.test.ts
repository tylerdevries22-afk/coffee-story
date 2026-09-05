import assert from 'node:assert/strict';
import test from 'node:test';

import { parseOrgDraft, type OrgInput } from './org-input';

const BASE: OrgInput = {
  name: 'Harbor Bakery', ownerEmail: 'OWNER@Example.com',
  organizationKind: 'franchisor', industryKey: 'general', blueprintKey: 'blank',
};

test('a franchisor becomes a normalized blank-slate tenant and network draft', () => {
  const result = parseOrgDraft(BASE);
  assert.ok(result.ok);
  assert.equal(result.draft.slug, 'harbor-bakery');
  assert.equal(result.draft.ownerEmail, 'owner@example.com');
  assert.equal(result.draft.location, null);
  assert.deepEqual(result.draft.modules, []);
  assert.deepEqual(result.draft.brandConfig, {
    identity: { slug: 'harbor-bakery', name: 'Harbor Bakery' },
  });
});

test('coffee blueprint installs a deliberate registered module set', () => {
  const result = parseOrgDraft({ ...BASE, industryKey: 'coffee-shop', blueprintKey: 'coffee-shop' });
  assert.ok(result.ok);
  assert.deepEqual(result.draft.modules.map((module) => module.key), [
    'commerce-catalog', 'commerce-ordering', 'commerce-payments',
    'workforce-operations', 'workforce-training', 'device-wall',
  ]);
});

test('construction blueprint spans projects, knowledge, training, and all five app surfaces', () => {
  const result = parseOrgDraft({ ...BASE, industryKey: 'construction', blueprintKey: 'construction' });
  assert.ok(result.ok);
  assert.deepEqual(result.draft.modules.map((module) => module.key), [
    'construction-projects', 'workforce-operations', 'workforce-training',
    'commerce-catalog', 'commerce-ordering', 'commerce-payments',
    'local-printing', 'device-wall',
  ]);
});

test('an explicit module selection expands registered dependencies in install order', () => {
  const result = parseOrgDraft({
    ...BASE, moduleKeys: ['commerce-payments'], connectorIds: ['stripe', 'square'],
  });
  assert.ok(result.ok);
  assert.deepEqual(result.draft.modules.map((module) => module.key), [
    'commerce-catalog', 'commerce-ordering', 'commerce-payments',
  ]);
  assert.deepEqual(result.draft.connectors, ['square', 'stripe']);
});

test('organization onboarding rejects unknown modules and uncertified MCPs', () => {
  assert.deepEqual(parseOrgDraft({ ...BASE, moduleKeys: ['not-a-module'] }), {
    ok: false, error: 'Choose only registered, compatible modules.',
  });
  assert.deepEqual(parseOrgDraft({ ...BASE, connectorIds: ['shopify'] }), {
    ok: false, error: 'Choose only available MCP Store providers.',
  });
});

test('the server rejects a construction module submitted for a coffee organization', () => {
  assert.deepEqual(parseOrgDraft({
    ...BASE, industryKey: 'coffee-shop', blueprintKey: 'coffee-shop',
    moduleKeys: ['construction-projects'],
  }), { ok: false, error: 'Choose only modules available for that industry.' });
});

test('a franchisee requires a network and complete first location', () => {
  const missing = parseOrgDraft({ ...BASE, organizationKind: 'franchisee' });
  assert.deepEqual(missing, { ok: false, error: 'Enter the franchise network handle.' });
  const result = parseOrgDraft({
    ...BASE, organizationKind: 'franchisee', networkSlug: 'harbor-network',
    territory: 'North district',
    location: {
      name: 'Downtown', timezone: 'America/Denver', openTime: '08:00',
      closeTime: '18:00', days: ['mon', 'tue'], city: 'Denver',
    },
  });
  assert.ok(result.ok);
  assert.equal(result.draft.location?.name, 'Downtown');
  assert.deepEqual(result.draft.territory, { description: 'North district' });
  assert.equal(result.draft.inheritancePolicy.mode, 'network-defaults');
});

test('boundaries reject invalid identity and classification inputs', () => {
  assert.equal(parseOrgDraft({ ...BASE, name: ' ' }).ok, false);
  assert.equal(parseOrgDraft({ ...BASE, name: 'A' }).ok, false);
  assert.equal(parseOrgDraft({ ...BASE, ownerEmail: 'not-email' }).ok, false);
  assert.equal(parseOrgDraft({ ...BASE, organizationKind: 'unknown' }).ok, false);
  assert.deepEqual(parseOrgDraft({ ...BASE, blueprintKey: 'construction' }), {
    ok: false, error: 'Choose the blueprint assigned to that industry.',
  });
});

test('a long name produces a database-safe 63-character handle', () => {
  const result = parseOrgDraft({ ...BASE, name: 'A'.repeat(80) });
  assert.ok(result.ok);
  assert.equal(result.draft.slug.length, 63);
});
