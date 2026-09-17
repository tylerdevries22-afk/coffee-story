import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { parseTenantModulesManifest, servesABuiltSurface } from './modules-manifest';
import { APP_SURFACES, BUILT_SURFACES } from './types';

const REPOSITORY_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');

const BASE = {
  schemaVersion: 1,
  modules: [{ key: 'commerce-catalog', version: '1.0.0' }],
};

function valid(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...BASE, ...extra };
}

describe('parseTenantModulesManifest', () => {
  it('accepts a minimal manifest and applies defaults', () => {
    const result = parseTenantModulesManifest(valid());
    assert.equal(result.kind, 'ok');
    if (result.kind !== 'ok') return;
    assert.equal(result.manifest.schemaVersion, 1);
    const [install] = result.manifest.modules;
    assert.equal(install?.key, 'commerce-catalog');
    assert.equal(install?.version, '1.0.0');
    assert.equal(install?.enabled, true);
    assert.equal(install?.config, null);
    assert.equal(install?.surfaces, null);
  });

  it('accepts a full manifest entry', () => {
    const result = parseTenantModulesManifest(valid({
      modules: [{
        key: 'device-wall', version: '2.3.1', config: 'modules/device-wall.json',
        surfaces: ['operator', 'display'], enabled: false,
      }],
    }));
    assert.equal(result.kind, 'ok');
    if (result.kind !== 'ok') return;
    const [install] = result.manifest.modules;
    assert.equal(install?.enabled, false);
    assert.equal(install?.config, 'modules/device-wall.json');
    assert.deepEqual(install?.surfaces, ['operator', 'display']);
  });

  it('rejects non-object input without throwing', () => {
    assert.equal(parseTenantModulesManifest(null).kind, 'invalid');
    assert.equal(parseTenantModulesManifest('device-wall').kind, 'invalid');
    assert.equal(parseTenantModulesManifest([valid()]).kind, 'invalid');
  });

  it('ignores unknown fields at the top level and per module', () => {
    const result = parseTenantModulesManifest(valid({
      $docs: { modules: 'Documentation is not data.' },
      modules: [{ key: 'device-wall', version: '1.0.0', rollout: 'registration_only' }],
    }));
    assert.equal(result.kind, 'ok');
  });

  it('requires schemaVersion to be an integer of at least 1', () => {
    assert.equal(parseTenantModulesManifest(valid({ schemaVersion: 0 })).kind, 'invalid');
    assert.equal(parseTenantModulesManifest(valid({ schemaVersion: 1.5 })).kind, 'invalid');
    assert.equal(parseTenantModulesManifest(valid({ schemaVersion: '1' })).kind, 'invalid');
  });

  it('requires modules to be a list of objects', () => {
    const notAList = parseTenantModulesManifest(valid({ modules: 'all' }));
    assert.equal(notAList.kind, 'invalid');
    if (notAList.kind !== 'invalid') return;
    assert.ok(notAList.issues.some((issue) => issue.includes('modules must be a list')));
    const badEntry = parseTenantModulesManifest(valid({ modules: ['commerce-catalog'] }));
    assert.equal(badEntry.kind, 'invalid');
    if (badEntry.kind !== 'invalid') return;
    assert.ok(badEntry.issues.some((issue) => issue.includes('modules[0] must be an object')));
  });

  it('rejects malformed module keys with a path-qualified message', () => {
    const result = parseTenantModulesManifest(valid({
      modules: [{ key: 'Commerce--Catalog', version: '1.0.0' }],
    }));
    assert.equal(result.kind, 'invalid');
    if (result.kind !== 'invalid') return;
    assert.ok(result.issues.some((issue) => issue.includes('modules[0].key')));
  });

  it('rejects versions that are not exact semantic versions', () => {
    for (const version of ['1.0', '^1.0.0', 'latest']) {
      const result = parseTenantModulesManifest(valid({
        modules: [{ key: 'commerce-catalog', version }],
      }));
      assert.equal(result.kind, 'invalid', version);
    }
  });

  it('rejects duplicate module keys', () => {
    const result = parseTenantModulesManifest(valid({
      modules: [
        { key: 'device-wall', version: '1.0.0' },
        { key: 'device-wall', version: '1.2.0' },
      ],
    }));
    assert.equal(result.kind, 'invalid');
    if (result.kind !== 'invalid') return;
    assert.ok(result.issues.some((issue) => issue.includes('modules[1].key duplicates modules[0].key')));
  });

  it('rejects absolute config paths and .. traversal', () => {
    const rejected = ['/etc/passwd', 'C:\\secrets.json', '\\\\share\\file', '../brand.json', 'modules/../../release.json'];
    for (const config of rejected) {
      const result = parseTenantModulesManifest(valid({
        modules: [{ key: 'commerce-catalog', version: '1.0.0', config }],
      }));
      assert.equal(result.kind, 'invalid', config);
    }
  });

  it('rejects a config that is not a non-empty string', () => {
    for (const config of ['', 7]) {
      const result = parseTenantModulesManifest(valid({
        modules: [{ key: 'commerce-catalog', version: '1.0.0', config }],
      }));
      assert.equal(result.kind, 'invalid', JSON.stringify(config));
    }
  });

  it('accepts nested relative config paths', () => {
    const result = parseTenantModulesManifest(valid({
      modules: [{ key: 'commerce-catalog', version: '1.0.0', config: 'modules/commerce-catalog/config.json' }],
    }));
    assert.equal(result.kind, 'ok');
  });

  it('rejects unknown surfaces and repeated surfaces', () => {
    const unknown = parseTenantModulesManifest(valid({
      modules: [{ key: 'commerce-catalog', version: '1.0.0', surfaces: ['kiosk', 'smartwatch'] }],
    }));
    assert.equal(unknown.kind, 'invalid');
    if (unknown.kind !== 'invalid') return;
    assert.ok(unknown.issues.some((issue) => issue.includes('modules[0].surfaces entry "smartwatch"')));
    const repeated = parseTenantModulesManifest(valid({
      modules: [{ key: 'commerce-catalog', version: '1.0.0', surfaces: ['kiosk', 'kiosk'] }],
    }));
    assert.equal(repeated.kind, 'invalid');
    assert.equal(parseTenantModulesManifest(valid({
      modules: [{ key: 'commerce-catalog', version: '1.0.0', surfaces: 'kiosk' }],
    })).kind, 'invalid');
  });

  it('requires enabled to be a boolean when present', () => {
    assert.equal(parseTenantModulesManifest(valid({
      modules: [{ key: 'commerce-catalog', version: '1.0.0', enabled: 'yes' }],
    })).kind, 'invalid');
  });

  it('collects every issue across entries rather than stopping at the first', () => {
    const result = parseTenantModulesManifest({
      schemaVersion: 0,
      modules: [{ key: 'Bad Key', version: '1.0' }, 'not-an-object'],
    });
    assert.equal(result.kind, 'invalid');
    if (result.kind !== 'invalid') return;
    assert.ok(result.issues.some((issue) => issue.includes('schemaVersion')));
    assert.ok(result.issues.some((issue) => issue.includes('modules[0]')));
    assert.ok(result.issues.some((issue) => issue.includes('modules[1]')));
  });

  it('parses tenants/_template/modules.json', () => {
    const path = join(REPOSITORY_ROOT, 'tenants', '_template', 'modules.json');
    const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
    const result = parseTenantModulesManifest(raw);
    assert.equal(result.kind, 'ok', result.kind === 'invalid' ? result.issues.join('; ') : '');
    if (result.kind !== 'ok') return;
    assert.deepEqual(result.manifest.modules.map((install) => install.key), [
      'commerce-catalog', 'device-wall',
    ]);
  });
});

/** Builds one install; `surfaces` is what this predicate reads. */
function install(surfaces: readonly string[] | null) {
  return {
    key: 'web-services', version: '1.0.0', config: null, enabled: true,
    surfaces: surfaces as never,
  };
}

describe('servesABuiltSurface', () => {
  it('counts a module on any surface this repo renders', () => {
    assert.equal(servesABuiltSurface(install(['customer'])), true);
    assert.equal(servesABuiltSurface(install(['admin', 'hq'])), true);
  });

  // The case the whole predicate exists for: Elevate's portal modules are
  // hosted there and are absent from MODULE_REGISTRY on purpose, so a registry
  // check that counted them would call a correct pack broken.
  it('excludes a module scoped entirely to a surface hosted elsewhere', () => {
    assert.equal(servesABuiltSurface(install(['admin'])), false);
  });

  it('counts an unconstrained install, since null means every surface', () => {
    assert.equal(servesABuiltSurface(install(null)), true);
  });

  // A guard against the widening being undone quietly: if `admin` ever rejoins
  // BUILT_SURFACES the case above starts returning true and this fails with it.
  it('keeps admin out of the built set', () => {
    assert.equal((BUILT_SURFACES as readonly string[]).includes('admin'), false);
    assert.equal((APP_SURFACES as readonly string[]).includes('admin'), true);
  });

  // `lobby` is declarable before it is buildable. It joins BUILT_SURFACES in
  // the same change that lands `apps/lobby`; until then a lobby-only module is
  // hosted nowhere this repo renders, exactly like an Elevate portal module.
  // Flipping this test is the deliberate signal that the surface now ships.
  it('keeps lobby declarable but not yet built', () => {
    assert.equal((APP_SURFACES as readonly string[]).includes('lobby'), true);
    assert.equal((BUILT_SURFACES as readonly string[]).includes('lobby'), false);
    assert.equal(servesABuiltSurface(install(['lobby'])), false);
  });
});
