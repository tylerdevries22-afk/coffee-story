import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { dependencySatisfied, parseModuleDefinition } from './manifest';
import type { ModuleDefinition } from './types';

const BASE = {
  key: 'commerce-ordering',
  version: '1.0.0',
  surfaces: ['kiosk', 'operator'],
  configSchemaVersion: 1,
};

function valid(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...BASE, ...extra };
}

describe('parseModuleDefinition', () => {
  it('accepts a minimal valid manifest and applies defaults', () => {
    const result = parseModuleDefinition(valid());
    assert.equal(result.kind, 'ok');
    if (result.kind !== 'ok') return;
    assert.deepEqual(result.definition.dependencies, []);
    assert.deepEqual(result.definition.permissions, []);
    assert.equal(result.definition.offline, 'none');
  });

  it('rejects non-object input without throwing', () => {
    assert.equal(parseModuleDefinition(null).kind, 'invalid');
    assert.equal(parseModuleDefinition('commerce').kind, 'invalid');
    assert.equal(parseModuleDefinition([valid()]).kind, 'invalid');
  });

  it('collects every issue rather than stopping at the first', () => {
    const result = parseModuleDefinition({
      key: 'Bad Key', version: '1.2', surfaces: [], configSchemaVersion: 0,
    });
    assert.equal(result.kind, 'invalid');
    if (result.kind !== 'invalid') return;
    assert.ok(result.issues.length >= 4, JSON.stringify(result.issues));
  });

  it('rejects unknown surfaces and malformed permissions', () => {
    const result = parseModuleDefinition(valid({
      surfaces: ['kiosk', 'smartwatch'], permissions: ['orders', 'orders:write'],
    }));
    assert.equal(result.kind, 'invalid');
    if (result.kind !== 'invalid') return;
    assert.ok(result.issues.some((issue) => issue.includes('smartwatch')));
    assert.ok(result.issues.some((issue) => issue.includes('orders"')));
  });

  it('rejects self-dependency and self-incompatibility', () => {
    const selfDep = parseModuleDefinition(valid({
      dependencies: [{ key: 'commerce-ordering', version: '^1.0.0' }],
    }));
    assert.equal(selfDep.kind, 'invalid');
    const selfIncompatible = parseModuleDefinition(valid({
      incompatibleWith: ['commerce-ordering'],
    }));
    assert.equal(selfIncompatible.kind, 'invalid');
  });

  it('rejects duplicate ownership entries', () => {
    const result = parseModuleDefinition(valid({ routes: ['/orders', '/orders'] }));
    assert.equal(result.kind, 'invalid');
  });

  it('requires dependency versions to be exact or caret ranges', () => {
    const result = parseModuleDefinition(valid({
      dependencies: [{ key: 'core-tenancy', version: 'latest' }],
    }));
    assert.equal(result.kind, 'invalid');
  });
});

describe('dependencySatisfied', () => {
  const ordering: ModuleDefinition = {
    key: 'commerce-ordering', version: '1.4.0', dependencies: [],
    surfaces: ['kiosk'], configSchemaVersion: 1, permissions: [],
    routes: [], jobs: [], events: [], offline: 'none',
    releasePrerequisites: [], incompatibleWith: [],
  };

  it('matches pins and caret ranges against the available version', () => {
    assert.equal(dependencySatisfied({ key: 'x', version: '1.4.0' }, ordering), true);
    assert.equal(dependencySatisfied({ key: 'x', version: '^1.0.0' }, ordering), true);
    assert.equal(dependencySatisfied({ key: 'x', version: '^2.0.0' }, ordering), false);
  });

  it('fails closed when the dependency is absent', () => {
    assert.equal(dependencySatisfied({ key: 'x', version: '^1.0.0' }, undefined), false);
  });
});
