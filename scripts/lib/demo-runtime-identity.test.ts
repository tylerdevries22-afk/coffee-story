import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, it } from 'node:test';

type Identity = {
  demoRuntimeBrandPath(appDirectory: string, app: string): string | null;
};

const require = createRequire(import.meta.url);
const { demoRuntimeBrandPath } = require('./demo-runtime-identity') as Identity;

function withEnv<T>(values: Readonly<Record<string, string | undefined>>, run: () => T): T {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

describe('demoRuntimeBrandPath', () => {
  it('is null outside demo runtime mode, so the caller falls through to its own tenant resolution', () => {
    withEnv({ EXPO_PUBLIC_DEMO_RUNTIME: undefined }, () => {
      assert.equal(demoRuntimeBrandPath('/apps/customer', 'customer'), null);
    });
  });

  it("names the neutral tenant's own brand.json in demo runtime mode", () => {
    withEnv({ EXPO_PUBLIC_DEMO_RUNTIME: '1', EXPO_PUBLIC_TENANT: undefined, TENANT: undefined }, () => {
      assert.equal(
        demoRuntimeBrandPath('/apps/customer', 'customer'),
        join('/apps/customer', 'src', 'tenants', 'juniper-base-demo', 'brand.json'),
      );
    });
  });

  it('refuses a named tenant, from either variable, alongside the demo flag', () => {
    withEnv({ EXPO_PUBLIC_DEMO_RUNTIME: '1', EXPO_PUBLIC_TENANT: 'coffee-story', TENANT: undefined }, () => {
      assert.throws(() => demoRuntimeBrandPath('/apps/customer', 'customer'), /cannot both be set/);
    });
    withEnv({ EXPO_PUBLIC_DEMO_RUNTIME: '1', EXPO_PUBLIC_TENANT: undefined, TENANT: 'coffee-story' }, () => {
      assert.throws(() => demoRuntimeBrandPath('/apps/kiosk', 'kiosk'), /cannot both be set/);
    });
  });
});
