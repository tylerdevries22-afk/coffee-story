import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  DEFAULT_CATALOG_SOURCES,
  resolveCatalogSources,
} from './lib/onboard-catalog-sources.js';

/**
 * The gate on catalog source resolution.
 *
 * `sources` shipped in every tenant's commerce-catalog config from the day it
 * was written, and its own docs promised a tenant could be re-pointed without
 * editing the manifest -- but nothing opened the file, so the promise was
 * false. What matters here is both halves: that a declaration is now obeyed,
 * and that a tenant which declares nothing resolves exactly where it used to.
 */
function tenant(files: Readonly<Record<string, string>>): string {
  const dir = mkdtempSync(join(tmpdir(), 'catalog-sources-'));
  for (const [path, contents] of Object.entries(files)) {
    const absolute = join(dir, path);
    mkdirSync(join(absolute, '..'), { recursive: true });
    writeFileSync(absolute, contents);
  }
  return dir;
}

const CONFIG = 'modules/commerce-catalog/config.json';

function manifest(config: string | null): string {
  return JSON.stringify({
    schemaVersion: 1,
    modules: [{ key: 'commerce-catalog', version: '1.0.0', config, enabled: true }],
  });
}

describe('resolveCatalogSources', () => {
  it('falls back to the historical filenames when a tenant declares nothing', () => {
    const problems: string[] = [];
    assert.deepEqual(resolveCatalogSources(tenant({}), problems), DEFAULT_CATALOG_SOURCES);
    assert.deepEqual(problems, []);
  });

  it('falls back when the tenant installs no commerce-catalog at all', () => {
    const dir = tenant({ 'modules.json': JSON.stringify({ schemaVersion: 1, modules: [] }) });
    const problems: string[] = [];
    assert.deepEqual(resolveCatalogSources(dir, problems), DEFAULT_CATALOG_SOURCES);
    assert.deepEqual(problems, []);
  });

  it('falls back when the install names no config artifact', () => {
    const dir = tenant({ 'modules.json': manifest(null) });
    assert.deepEqual(resolveCatalogSources(dir, []), DEFAULT_CATALOG_SOURCES);
  });

  // The case every shipped tenant is in today: a config that declares exactly
  // the defaults. It must resolve to the same paths onboarding hard-coded, or
  // this change is not the no-op it claims to be.
  it('resolves the shipped config to the same paths onboarding used before', () => {
    const dir = tenant({
      'modules.json': manifest(CONFIG),
      [CONFIG]: JSON.stringify({
        schemaVersion: 1, moduleId: 'commerce-catalog', sources: DEFAULT_CATALOG_SOURCES,
      }),
    });
    const problems: string[] = [];
    assert.deepEqual(resolveCatalogSources(dir, problems), DEFAULT_CATALOG_SOURCES);
    assert.deepEqual(problems, []);
  });

  it('obeys a re-pointed source and leaves the rest at their defaults', () => {
    const dir = tenant({
      'modules.json': manifest(CONFIG),
      [CONFIG]: JSON.stringify({ sources: { offerings: 'catalog.json' } }),
    });
    const problems: string[] = [];
    const resolved = resolveCatalogSources(dir, problems);
    assert.equal(resolved.offerings, 'catalog.json');
    assert.equal(resolved.folders, DEFAULT_CATALOG_SOURCES.folders);
    assert.equal(resolved.modifierGroups, DEFAULT_CATALOG_SOURCES.modifierGroups);
    assert.deepEqual(problems, []);
  });

  // A catalog that can be pointed anywhere is a file-read primitive, not a
  // configuration surface. Each rejection keeps the default rather than
  // failing open to the attacker's path.
  for (const escape of ['../secrets.json', '/etc/passwd', 'a/../../b.csv', 'C:\\x.csv']) {
    it(`refuses a source escaping the tenant folder: ${escape}`, () => {
      const dir = tenant({
        'modules.json': manifest(CONFIG),
        [CONFIG]: JSON.stringify({ sources: { offerings: escape } }),
      });
      const problems: string[] = [];
      const resolved = resolveCatalogSources(dir, problems);
      assert.equal(resolved.offerings, DEFAULT_CATALOG_SOURCES.offerings);
      assert.equal(problems.length, 1);
      assert.match(problems[0] ?? '', /sources\.offerings must name a file inside the tenant folder/);
    });
  }

  it('reports a sources block that is not an object, and keeps the defaults', () => {
    const dir = tenant({
      'modules.json': manifest(CONFIG),
      [CONFIG]: JSON.stringify({ sources: 'menu.csv' }),
    });
    const problems: string[] = [];
    assert.deepEqual(resolveCatalogSources(dir, problems), DEFAULT_CATALOG_SOURCES);
    assert.equal(problems.length, 1);
    assert.match(problems[0] ?? '', /sources must be an object/);
  });

  // Nothing else catches this. modulesManifestProblems checks only that the
  // declared config path IS A FILE -- it never opens it -- so silence here
  // would let a tenant believe it had re-pointed its catalog when the file it
  // re-pointed with does not parse.
  it('reports a config that is not valid JSON, and keeps the defaults', () => {
    const dir = tenant({ 'modules.json': manifest(CONFIG), [CONFIG]: '{ not json' });
    const problems: string[] = [];
    assert.deepEqual(resolveCatalogSources(dir, problems), DEFAULT_CATALOG_SOURCES);
    assert.equal(problems.length, 1);
    assert.match(problems[0] ?? '', /must contain one JSON object/);
  });
});
