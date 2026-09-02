import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { resolveModules } from './resolve';
import type { ModuleDefinition } from './types';

function moduleOf(
  key: string,
  extra: Partial<ModuleDefinition> = {},
): ModuleDefinition {
  return {
    key, version: '1.0.0', dependencies: [], surfaces: ['hq'],
    configSchemaVersion: 1, permissions: [], routes: [], jobs: [],
    events: [], offline: 'none', releasePrerequisites: [],
    incompatibleWith: [], ...extra,
  };
}

describe('resolveModules', () => {
  it('resolves a dependency chain in dependency-first order', () => {
    const registry = [
      moduleOf('commerce-ordering', { dependencies: [{ key: 'core-tenancy', version: '^1.0.0' }] }),
      moduleOf('core-tenancy'),
    ];
    const result = resolveModules(registry, ['commerce-ordering']);
    assert.equal(result.kind, 'ok');
    if (result.kind !== 'ok') return;
    assert.deepEqual(result.modules.map((module) => module.key), ['core-tenancy', 'commerce-ordering']);
  });

  it('is deterministic regardless of registry order', () => {
    const a = moduleOf('a-root', { dependencies: [{ key: 'b-shared', version: '1.0.0' }] });
    const b = moduleOf('b-shared');
    const c = moduleOf('c-root', { dependencies: [{ key: 'b-shared', version: '^1.0.0' }] });
    const forward = resolveModules([a, b, c], ['a-root', 'c-root']);
    const backward = resolveModules([c, b, a], ['c-root', 'a-root']);
    assert.equal(forward.kind, 'ok');
    assert.equal(backward.kind, 'ok');
    if (forward.kind !== 'ok' || backward.kind !== 'ok') return;
    assert.deepEqual(
      forward.modules.map((module) => module.key),
      backward.modules.map((module) => module.key),
    );
  });

  it('rejects an unknown requested module', () => {
    const result = resolveModules([], ['ghost-module']);
    assert.equal(result.kind, 'failed');
    if (result.kind !== 'failed') return;
    assert.deepEqual(result.errors, [{ kind: 'unknown-module', key: 'ghost-module' }]);
  });

  it('names the parent of an unknown transitive dependency', () => {
    const result = resolveModules([
      moduleOf('commerce-ordering', { dependencies: [{ key: 'ghost-dep', version: '1.0.0' }] }),
    ], ['commerce-ordering']);
    assert.equal(result.kind, 'failed');
    if (result.kind !== 'failed') return;
    assert.deepEqual(result.errors, [
      { kind: 'unknown-dependency', key: 'commerce-ordering', dependency: 'ghost-dep' },
    ]);
  });

  it('rejects an unsatisfied version range', () => {
    const registry = [
      moduleOf('growth-loyalty', { dependencies: [{ key: 'core-tenancy', version: '^2.0.0' }] }),
      moduleOf('core-tenancy', { version: '1.4.0' }),
    ];
    const result = resolveModules(registry, ['growth-loyalty']);
    assert.equal(result.kind, 'failed');
    if (result.kind !== 'failed') return;
    assert.deepEqual(result.errors, [{
      kind: 'version-mismatch', key: 'growth-loyalty',
      dependency: 'core-tenancy', wanted: '^2.0.0', found: '1.4.0',
    }]);
  });

  it('rejects an incompatible pair exactly once', () => {
    const registry = [
      moduleOf('pos-alpha', { incompatibleWith: ['pos-beta'] }),
      moduleOf('pos-beta', { incompatibleWith: ['pos-alpha'] }),
    ];
    const result = resolveModules(registry, ['pos-alpha', 'pos-beta']);
    assert.equal(result.kind, 'failed');
    if (result.kind !== 'failed') return;
    assert.deepEqual(result.errors, [{ kind: 'incompatible', a: 'pos-alpha', b: 'pos-beta' }]);
  });

  it('rejects a dependency cycle', () => {
    const registry = [
      moduleOf('cycle-a', { dependencies: [{ key: 'cycle-b', version: '1.0.0' }] }),
      moduleOf('cycle-b', { dependencies: [{ key: 'cycle-a', version: '1.0.0' }] }),
    ];
    const result = resolveModules(registry, ['cycle-a']);
    assert.equal(result.kind, 'failed');
    if (result.kind !== 'failed') return;
    assert.deepEqual(result.errors, [{ kind: 'cycle', keys: ['cycle-a', 'cycle-b'] }]);
  });
});
