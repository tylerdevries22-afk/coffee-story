import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { parseTenantManifest } from './parser';

const TENANTS = join(dirname(fileURLToPath(import.meta.url)), '../../..', 'tenants');

describe('shipped tenant manifests', () => {
  for (const entry of readdirSync(TENANTS, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const path = join(TENANTS, entry.name, 'brand.json');
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    } catch {
      continue;
    }
    it(`${entry.name}/brand.json satisfies the v1 contract`, () => {
      const result = parseTenantManifest(raw);
      assert.equal(result.kind, 'ok', result.kind === 'invalid' ? result.issues.join('; ') : '');
    });
  }
});
