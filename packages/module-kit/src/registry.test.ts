import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseModuleDefinition } from './manifest';
import {
  LEGACY_FLAG_MODULE_MAP, MODULE_REGISTRY, legacyFlagInstallations,
} from './registry';
import { resolveModules } from './resolve';

const REGISTRY_KEYS = MODULE_REGISTRY.map((definition) => definition.key);

/** Dependency-first with alphabetical ties: the one order every run must produce. */
const RESOLVED_ORDER = [
  'commerce-catalog', 'commerce-ordering', 'commerce-catering', 'commerce-delivery',
  'commerce-payments', 'construction-projects', 'device-wall', 'growth-drops',
  'growth-loyalty', 'growth-referrals', 'growth-stored-value', 'local-printing',
  'workforce-operations', 'workforce-training',
];

describe('MODULE_REGISTRY', () => {
  it('parses every definition through the manifest gate, unchanged', () => {
    for (const definition of MODULE_REGISTRY) {
      const parsed = parseModuleDefinition(definition);
      assert.equal(parsed.kind, 'ok', `${definition.key} must parse: ${JSON.stringify(parsed)}`);
      if (parsed.kind === 'ok') assert.deepEqual(parsed.definition, definition);
    }
  });

  it('never repeats a key', () => {
    assert.equal(new Set(REGISTRY_KEYS).size, REGISTRY_KEYS.length);
  });

  it('declares only dependencies that exist in the registry', () => {
    const keys = new Set(REGISTRY_KEYS);
    for (const definition of MODULE_REGISTRY) {
      for (const dependency of definition.dependencies) {
        assert.ok(keys.has(dependency.key),
          `${definition.key} depends on unregistered module ${dependency.key}`);
      }
    }
  });

  it('resolves the full catalog in one deterministic order', () => {
    const forward = resolveModules(MODULE_REGISTRY, REGISTRY_KEYS);
    const reversed = resolveModules(MODULE_REGISTRY, [...REGISTRY_KEYS].reverse());
    assert.equal(forward.kind, 'ok', JSON.stringify(forward));
    assert.equal(reversed.kind, 'ok', JSON.stringify(reversed));
    if (forward.kind !== 'ok' || reversed.kind !== 'ok') return;
    assert.deepEqual(forward.modules.map((module) => module.key), RESOLVED_ORDER);
    assert.deepEqual(reversed.modules.map((module) => module.key), RESOLVED_ORDER);
  });
});

describe('LEGACY_FLAG_MODULE_MAP', () => {
  it('maps every flag onto a registered module, and no two share one', () => {
    const keys = new Set(REGISTRY_KEYS);
    const entries = Object.entries(LEGACY_FLAG_MODULE_MAP);
    for (const [flag, moduleKey] of entries) {
      assert.ok(keys.has(moduleKey), `${flag} maps to unregistered module ${moduleKey}`);
    }
    assert.equal(new Set(Object.values(LEGACY_FLAG_MODULE_MAP)).size, entries.length,
      'two flags sharing a module would double-install it');
  });

  it('leaves capacity and integration settings unmapped', () => {
    assert.ok(!('multi_location' in LEGACY_FLAG_MODULE_MAP));
    assert.ok(!('sms' in LEGACY_FLAG_MODULE_MAP));
  });
});

describe('legacyFlagInstallations', () => {
  it('returns the module key for each true flag, in map order', () => {
    assert.deepEqual(
      legacyFlagInstallations({
        stored_value: true, referrals: true, drops: true,
        catering: true, delivery: true, operations: true,
      }),
      ['growth-stored-value', 'growth-referrals', 'growth-drops',
        'commerce-catering', 'commerce-delivery', 'workforce-operations'],
    );
    assert.deepEqual(
      legacyFlagInstallations({ operations: true, stored_value: true }),
      ['growth-stored-value', 'workforce-operations'],
    );
  });

  it('omits false, absent, and unmapped flags', () => {
    assert.deepEqual(legacyFlagInstallations({ drops: false, catering: true }),
      ['commerce-catering']);
    assert.deepEqual(legacyFlagInstallations({}), []);
    assert.deepEqual(legacyFlagInstallations({ sms: true, multi_location: true }), []);
  });
});
