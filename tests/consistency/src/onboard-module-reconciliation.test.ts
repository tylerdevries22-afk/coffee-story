import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { TenantModulesManifest } from '../../../packages/module-kit/src/modules-manifest.ts';
import { reconcileTenantModules } from '../../../scripts/onboard-module-installs.ts';

const temporary: string[] = [];
afterEach(() => temporary.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

function tenantDir(): string {
  const directory = mkdtempSync(join(tmpdir(), 'module-reconcile-'));
  temporary.push(directory);
  writeFileSync(join(directory, 'catalog.json'), '{"z":1,"a":{"two":2,"one":1}}');
  return directory;
}

function manifest(reversed = false): TenantModulesManifest {
  const modules = [
    { key: 'commerce-catalog', version: '1.0.0', config: 'catalog.json', surfaces: ['customer'] as const, enabled: true },
    { key: 'device-wall', version: '1.0.0', config: null, surfaces: ['display'] as const, enabled: false },
  ];
  return { schemaVersion: 1, modules: reversed ? modules.reverse() : modules };
}

type RpcCall = { name: string; args: Record<string, unknown> };

function fakeDb(error: { message: string } | null = null): { db: SupabaseClient; calls: RpcCall[] } {
  const calls: RpcCall[] = [];
  const db = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return { data: null, error };
    },
  };
  return { db: db as unknown as SupabaseClient, calls };
}

describe('tenant module reconciliation', () => {
  it('sends one complete desired-state snapshot sourced from modules.json', async () => {
    const { db, calls } = fakeDb();
    const result = await reconcileTenantModules(db, 'brand-id', tenantDir(), manifest());
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.name, 'reconcile_brand_modules');
    const modules = calls[0]?.args.p_modules as Record<string, unknown>[];
    assert.deepEqual(modules.map((module) => module.key), ['commerce-catalog', 'device-wall']);
    assert.deepEqual(modules[0]?.config, { z: 1, a: { two: 2, one: 1 } });
    assert.deepEqual(result.enabled, ['commerce-catalog']);
    assert.deepEqual(result.disabled, ['device-wall']);
  });

  it('uses the same idempotency key regardless of declaration order', async () => {
    const directory = tenantDir();
    const first = await reconcileTenantModules(fakeDb().db, 'brand-id', directory, manifest());
    const second = await reconcileTenantModules(fakeDb().db, 'brand-id', directory, manifest(true));
    assert.equal(first.idempotencyKey, second.idempotencyKey);
  });

  it('returns a safe contextual error from the reconciliation RPC', async () => {
    const { db } = fakeDb({ message: 'revision conflict' });
    await assert.rejects(
      reconcileTenantModules(db, 'brand-id', tenantDir(), manifest()),
      /Could not reconcile tenant modules: revision conflict/,
    );
  });
});
