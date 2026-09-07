import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { runInNewContext } from 'node:vm';
import cache from './metro-runtime-cache.js';

const { runtimeCacheKey } = cache;
const root = path.resolve(import.meta.dirname, '../..');

function appCache(app, environment) {
  const directory = path.join(root, 'apps', app);
  const context = {
    __dirname: directory, process: { env: { ...environment } }, module: { exports: {} },
    require(name) {
      if (name === 'expo/metro-config') return { getDefaultConfig: () => ({}) };
      if (name === 'metro-cache') return { FileStore: class { constructor(options) { this.root = options.root; } } };
      if (name === 'path') return path;
      if (name.endsWith('/metro-runtime-cache')) return cache;
      if (name.endsWith('/tenant-bundle-resolver')) return { withTenantBundleResolver: (config) => config };
      throw new Error(`Unexpected Metro dependency: ${name}`);
    },
  };
  runInNewContext(readFileSync(path.join(directory, 'metro.config.js'), 'utf8'), context);
  return context.module.exports.cacheStores[0].root;
}

describe('shared Metro runtime cache', () => {
  it('is deterministic, order independent, and excludes private environment values', () => {
    const inputs = { EXPO_PUBLIC_TENANT: 'one', EXPO_PUBLIC_API_URL: 'https://api.example.test' };
    assert.equal(runtimeCacheKey(inputs), runtimeCacheKey({ ...inputs, PRIVATE_TOKEN: 'test-only' }));
    assert.equal(runtimeCacheKey(inputs), runtimeCacheKey(Object.fromEntries(Object.entries(inputs).reverse())));
    assert.match(runtimeCacheKey(inputs), /^[a-f0-9]{24}$/);
  });

  it('isolates every public input, including preview mode and tenant changes', () => {
    const base = { EXPO_PUBLIC_TENANT: 'stillpoint-builders' };
    for (const change of [
      { EXPO_PUBLIC_TENANT: 'juniper-base-demo' }, { EXPO_PUBLIC_PREVIEW_WALL: '1' },
      { EXPO_PUBLIC_DEMO_SYNC_URL: 'http://localhost:3300/api/demo-sync' },
      { EXPO_PUBLIC_NEW_FLAG: 'future' },
    ]) assert.notEqual(runtimeCacheKey(base), runtimeCacheKey({ ...base, ...change }));
  });

  it('wires all three Metro configs to app-specific and tenant-specific cache roots', () => {
    const roots = new Set();
    for (const app of ['customer', 'operator', 'kiosk']) {
      const base = appCache(app, { EXPO_PUBLIC_TENANT: 'stillpoint-builders' });
      roots.add(base);
      assert.notEqual(base, appCache(app, { EXPO_PUBLIC_TENANT: 'juniper-base-demo' }));
      assert.notEqual(base, appCache(app, { EXPO_PUBLIC_TENANT: 'stillpoint-builders', EXPO_PUBLIC_PREVIEW_WALL: '1' }));
      assert.ok(base.startsWith(path.join(root, 'apps', app, '.metro-cache')));
    }
    assert.equal(roots.size, 3);
  });
});
