import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';

import { applyTenantSlot } from '../../../scripts/onboard-tenant-slots.ts';

const temporary: string[] = [];
afterEach(() => temporary.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

describe('tenant surface slots', () => {
  it('removes this slug from guest apps omitted by a narrower manifest', () => {
    const root = mkdtempSync(join(tmpdir(), 'tenant-surface-'));
    temporary.push(root);
    for (const app of ['customer', 'kiosk']) {
      mkdirSync(join(root, 'apps', app, 'src', 'tenants'), { recursive: true });
    }
    const tenantDir = join(root, 'tenants', 'customer-only');
    mkdirSync(tenantDir, { recursive: true });
    writeFileSync(join(tenantDir, 'brand.json'), '{}');
    writeFileSync(join(tenantDir, 'modules.json'), '{"schemaVersion":1,"modules":[]}');
    mkdirSync(join(tenantDir, 'assets', 'menu'), { recursive: true });
    writeFileSync(join(tenantDir, 'assets', 'menu', 'sample.webp'), 'sample');

    applyTenantSlot({
      root, tenantDir, slug: 'customer-only', menuJson: '{"categories":[],"items":[]}',
      itemSlugs: ['sample'], surfaces: ['customer', 'kiosk'],
    });
    assert.equal(existsSync(join(root, 'apps', 'kiosk', 'src', 'tenants', 'customer-only')), true);
    assert.equal(existsSync(join(root, 'apps', 'kiosk', 'assets', 'menu', 'customer-only')), true);

    applyTenantSlot({
      root, tenantDir, slug: 'customer-only', menuJson: '{"categories":[],"items":[]}',
      itemSlugs: ['sample'], surfaces: ['customer'],
    });

    assert.equal(existsSync(join(root, 'apps', 'customer', 'src', 'tenants', 'customer-only')), true);
    assert.equal(existsSync(join(root, 'apps', 'kiosk', 'src', 'tenants', 'customer-only')), false);
    assert.equal(existsSync(join(root, 'apps', 'kiosk', 'assets', 'menu', 'customer-only')), false);

    applyTenantSlot({
      root, tenantDir, slug: 'customer-only', menuJson: '{"categories":[],"items":[]}',
      itemSlugs: ['sample'], surfaces: [],
    });
    assert.equal(existsSync(join(root, 'apps', 'customer', 'src', 'tenants', 'customer-only')), false);
    assert.equal(existsSync(join(root, 'apps', 'customer', 'assets', 'menu', 'customer-only')), false);
  });
});
