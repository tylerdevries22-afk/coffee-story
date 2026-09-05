import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { assertTenantBundle } from '../../../scripts/assert-tenant-bundle.ts';

type Resolver = {
  selectedTenant(appRoot: string, requested?: string): string;
  tenantBundlePath(appRoot: string, moduleName: string, requested?: string): string | null;
  withTenantBundleResolver(
    config: { resolver: { resolveRequest?: MetroResolve } },
    appRoot: string,
  ): { resolver: { resolveRequest: MetroResolve } };
};

type MetroContext = {
  resolveRequest(context: MetroContext, moduleName: string, platform: string): unknown;
};
type MetroResolve = (context: MetroContext, moduleName: string, platform: string) => unknown;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(import.meta.url);
const resolver = require('../../../scripts/lib/tenant-bundle-resolver.js') as Resolver;

function fixture(source: string, runtime = ''): string {
  const output = mkdtempSync(join(tmpdir(), 'tenant-bundle-'));
  const map = join(output, 'bundle.js.map');
  writeFileSync(map, JSON.stringify({ sources: [source] }));
  writeFileSync(join(output, 'bundle.js'), runtime);
  return output;
}

describe('tenant bundle resolver', () => {
  for (const app of ['customer', 'kiosk'] as const) {
    for (const tenant of ['coffee-story', 'stillpoint-builders']) {
      it(`resolves ${app}/${tenant} imports only inside the selected slot`, () => {
        const appRoot = join(ROOT, 'apps', app);
        const brand = resolver.tenantBundlePath(appRoot, '@tenant-bundle/config/brand', tenant);
        const logo = resolver.tenantBundlePath(appRoot, '@tenant-bundle/artwork/brand/logo.png', tenant);
        assert.equal(resolver.selectedTenant(appRoot, tenant), tenant);
        assert.match(brand ?? '', new RegExp(`/tenants/${tenant}/brand\\.json$`));
        assert.match(logo ?? '', new RegExp(`/tenants/${tenant}/brand/logo\\.png$`));
      });
    }
  }

  it('fails closed for unset, unknown, and escaping selections', () => {
    const appRoot = join(ROOT, 'apps', 'customer');
    assert.throws(() => resolver.selectedTenant(appRoot, ''), /requires EXPO_PUBLIC_TENANT/);
    assert.throws(() => resolver.selectedTenant(appRoot, 'not-applied'), /is not applied/);
    assert.throws(
      () => resolver.tenantBundlePath(appRoot, '@tenant-bundle/artwork/../../secret', 'coffee-story'),
      /escapes its selected asset root/,
    );
  });

  it('chains selected and ordinary imports through Metro resolution', () => {
    const calls: string[] = [];
    const config = { resolver: {} };
    const configured = resolver.withTenantBundleResolver(config, join(ROOT, 'apps', 'customer'));
    const previous = process.env.EXPO_PUBLIC_TENANT;
    process.env.EXPO_PUBLIC_TENANT = 'coffee-story';
    const context: MetroContext = {
      resolveRequest: (_context, name) => { calls.push(name); return name; },
    };
    try {
      configured.resolver.resolveRequest(context, '@tenant-bundle/config/brand', 'web');
      configured.resolver.resolveRequest(context, 'react', 'web');
      assert.match(calls[0] ?? '', /tenants\/coffee-story\/brand\.json$/);
      assert.equal(calls[1], 'react');
    } finally {
      if (previous === undefined) delete process.env.EXPO_PUBLIC_TENANT;
      else process.env.EXPO_PUBLIC_TENANT = previous;
    }
  });

  it('keeps production barrels tenant-neutral', () => {
    for (const app of ['customer', 'kiosk']) {
      const directory = join(ROOT, 'apps', app, 'src', 'tenants');
      const production = ['selected.ts', 'selected-media.ts']
        .map((file) => readFileSync(join(directory, file), 'utf8')).join('\n');
      assert.doesNotMatch(production, /coffee-story|stillpoint-builders/);
      assert.match(production, /@tenant-bundle\//);
    }
  });
});

describe('exported tenant bundle assertion', () => {
  const selected = '/src/tenants/coffee-story/brand.json';

  it('accepts a selected-only source map and runtime', () => {
    assert.doesNotThrow(() => assertTenantBundle({
      app: 'customer', tenant: 'coffee-story', output: fixture(selected), root: ROOT,
    }));
  });

  it('rejects a foreign source, public path, or identity marker', () => {
    const sourceLeak = fixture(selected);
    writeFileSync(join(sourceLeak, 'foreign.js.map'), JSON.stringify({
      sources: ['/src/tenants/stillpoint-builders/brand.json'],
    }));
    assert.throws(() => assertTenantBundle({
      app: 'customer', tenant: 'coffee-story', output: sourceLeak, root: ROOT,
    }), /Foreign tenant source/);

    const publicLeak = fixture(selected);
    const publicFile = join(publicLeak, 'tenants', 'stillpoint-builders', 'icon.png');
    mkdirSync(dirname(publicFile), { recursive: true });
    writeFileSync(publicFile, 'image');
    assert.throws(() => assertTenantBundle({
      app: 'customer', tenant: 'coffee-story', output: publicLeak, root: ROOT,
    }), /Foreign tenant public file/);

    const identityLeak = fixture(selected, 'Stillpoint Builders');
    assert.throws(() => assertTenantBundle({
      app: 'customer', tenant: 'coffee-story', output: identityLeak, root: ROOT,
    }), /Foreign tenant identity/);
  });
});
