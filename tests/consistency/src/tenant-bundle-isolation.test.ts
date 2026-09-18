import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { assertTenantBundle } from '../../../scripts/assert-tenant-bundle.ts';

type Resolver = {
  demoRuntimeEnabled(): boolean;
  selectedTenant(appRoot: string, requested?: string): string;
  tenantBundlePath(appRoot: string, moduleName: string, requested?: string): string | null;
  withTenantBundleResolver(
    config: { resolver: { resolveRequest?: MetroResolve } },
    appRoot: string,
  ): { resolver: { resolveRequest: MetroResolve } };
};

/** Runs `run` with EXPO_PUBLIC_DEMO_RUNTIME set, restoring whatever was there before. */
function withDemoRuntime<T>(run: () => T): T {
  const previous = process.env.EXPO_PUBLIC_DEMO_RUNTIME;
  process.env.EXPO_PUBLIC_DEMO_RUNTIME = '1';
  try {
    return run();
  } finally {
    if (previous === undefined) delete process.env.EXPO_PUBLIC_DEMO_RUNTIME;
    else process.env.EXPO_PUBLIC_DEMO_RUNTIME = previous;
  }
}

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

describe('demo runtime resolver', () => {
  it('reflects EXPO_PUBLIC_DEMO_RUNTIME', () => {
    assert.equal(resolver.demoRuntimeEnabled(), false);
    withDemoRuntime(() => assert.equal(resolver.demoRuntimeEnabled(), true));
  });

  for (const app of ['customer', 'kiosk'] as const) {
    it(`resolves ${app}'s config and generated requests to src/demo-runtime/, with no tenant needed at all`, () => {
      const appRoot = join(ROOT, 'apps', app);
      withDemoRuntime(() => {
        for (const request of ['config/brand', 'config/menu', 'config/modules', 'generated/menu-media']) {
          const target = resolver.tenantBundlePath(appRoot, `@tenant-bundle/${request}`);
          assert.match(
            target ?? '',
            new RegExp(`src/demo-runtime/${request}\\.ts$`),
            `${app} ${request} -> ${String(target)}`,
          );
        }
      });
    });

    it(`resolves ${app}'s logo to its own runtime module, not the neutral tenant's file`, () => {
      const appRoot = join(ROOT, 'apps', app);
      withDemoRuntime(() => {
        const logo = resolver.tenantBundlePath(appRoot, '@tenant-bundle/artwork/brand/logo.png');
        assert.match(logo ?? '', /src\/demo-runtime\/artwork\/brand\/logo\.ts$/);
      });
    });
  }

  it("resolves customer's product-media request too, which kiosk never imports", () => {
    const appRoot = join(ROOT, 'apps', 'customer');
    withDemoRuntime(() => {
      const target = resolver.tenantBundlePath(appRoot, '@tenant-bundle/generated/product-media');
      assert.match(target ?? '', /src\/demo-runtime\/generated\/product-media\.ts$/);
    });
  });

  it("resolves every other artwork key to the neutral reference tenant's real asset", () => {
    const appRoot = join(ROOT, 'apps', 'customer');
    withDemoRuntime(() => {
      const hero = resolver.tenantBundlePath(appRoot, '@tenant-bundle/artwork/hero/home-hero.mp4');
      assert.match(hero ?? '', /assets\/tenants\/juniper-base-demo\/hero\/home-hero\.mp4$/);
    });
  });

  it('never calls selectedTenant, so an unset or unapplied EXPO_PUBLIC_TENANT cannot fail it', () => {
    const appRoot = join(ROOT, 'apps', 'customer');
    const previous = process.env.EXPO_PUBLIC_TENANT;
    delete process.env.EXPO_PUBLIC_TENANT;
    try {
      withDemoRuntime(() => {
        assert.doesNotThrow(() => resolver.tenantBundlePath(appRoot, '@tenant-bundle/config/brand'));
      });
    } finally {
      if (previous === undefined) delete process.env.EXPO_PUBLIC_TENANT;
      else process.env.EXPO_PUBLIC_TENANT = previous;
    }
  });

  it('still fails closed for an artwork request that escapes the neutral asset root', () => {
    const appRoot = join(ROOT, 'apps', 'customer');
    withDemoRuntime(() => {
      assert.throws(
        () => resolver.tenantBundlePath(appRoot, '@tenant-bundle/artwork/../../secret'),
        /escapes its selected asset root/,
      );
    });
  });

  it('chains through Metro resolution exactly like a normal tenant build', () => {
    const calls: string[] = [];
    const config = { resolver: {} };
    const configured = resolver.withTenantBundleResolver(config, join(ROOT, 'apps', 'customer'));
    const context: MetroContext = {
      resolveRequest: (_context, name) => { calls.push(name); return name; },
    };
    withDemoRuntime(() => {
      configured.resolver.resolveRequest(context, '@tenant-bundle/config/brand', 'web');
      configured.resolver.resolveRequest(context, 'react', 'web');
    });
    assert.match(calls[0] ?? '', /src\/demo-runtime\/config\/brand\.ts$/);
    assert.equal(calls[1], 'react');
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
