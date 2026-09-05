import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';

import { applyAppArtwork } from '../../../scripts/onboard-app-artwork.ts';

const GENERATED = [
  'splash-logo.png', 'icon.png', 'android-foreground.png', 'android-background.png',
  'android-monochrome.png', 'favicon.png', 'icon-180.png',
];
const ILLUSTRATIONS = [
  'hero/home-hero.mp4', 'hero/stones.webp',
  'gift/birthday-cake.webp', 'gift/birthday-confetti.webp', 'gift/congrats-bloom.webp',
  'gift/congrats-gold.webp', 'gift/grateful.webp', 'gift/healing-oil.webp',
  'gift/quiet-hour.webp', 'gift/thank-you.webp', 'rewards/liquid-nebula.webp',
];
const BRAND = {
  identity: { name: 'Tenant A' }, tokens: { primary: '#111111', surface: '#FFFFFF' }, copy: {},
};

const temporary: string[] = [];
afterEach(() => temporary.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

function fixture(): { root: string; tenant: string } {
  const root = mkdtempSync(join(tmpdir(), 'tenant-artwork-'));
  temporary.push(root);
  const tenant = join(root, 'tenants', 'tenant-a');
  for (const app of ['customer', 'kiosk']) mkdirSync(join(root, 'apps', app, 'assets', 'images'), { recursive: true });
  mkdirSync(join(tenant, 'app-store', 'generated'), { recursive: true });
  return { root, tenant };
}

function file(path: string, contents = 'tenant-a'): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, contents);
}

function seedComplete(tenant: string, contents = 'tenant-a'): void {
  for (const name of GENERATED) file(join(tenant, 'app-store', 'generated', name), contents);
  for (const name of ILLUSTRATIONS) file(join(tenant, 'assets', name), contents);
}

describe('per-tenant artwork reconciliation', () => {
  it('fails before changing a destination when generated assets are incomplete', () => {
    const { root, tenant } = fixture();
    const destination = join(root, 'apps', 'kiosk', 'assets', 'tenants', 'tenant-a', 'images', 'icon.png');
    file(destination, 'previous-tenant');
    assert.throws(
      () => applyAppArtwork(root, 'tenant-a', tenant, BRAND, ['kiosk']),
      /Generated artwork is incomplete/,
    );
    assert.equal(readFileSync(destination, 'utf8'), 'previous-tenant');
  });

  it('removes stale illustrations while copying the complete customer set', () => {
    const { root, tenant } = fixture();
    seedComplete(tenant);
    const stale = join(root, 'apps', 'customer', 'assets', 'tenants', 'tenant-a', 'gift', 'old-brand.webp');
    file(stale, 'previous-tenant');
    applyAppArtwork(root, 'tenant-a', tenant, BRAND, ['customer']);
    assert.equal(existsSync(stale), false);
    assert.equal(
      readFileSync(join(root, 'apps', 'customer', 'assets', 'tenants', 'tenant-a', 'gift', 'birthday-cake.webp'), 'utf8'),
      'tenant-a',
    );
    assert.match(
      readFileSync(join(root, 'apps', 'customer', 'public', 'tenants', 'tenant-a', 'manifest.webmanifest'), 'utf8'),
      /"src": "\/icon\.png"/,
    );
  });

  it('removes this slug artwork from guest apps omitted by a narrower manifest', () => {
    const { root, tenant } = fixture();
    seedComplete(tenant);
    applyAppArtwork(root, 'tenant-a', tenant, BRAND, ['customer', 'kiosk']);
    const customer = join(root, 'apps', 'customer', 'assets', 'tenants', 'tenant-a');
    const customerWeb = join(root, 'apps', 'customer', 'public', 'tenants', 'tenant-a');
    assert.equal(existsSync(customer), true);
    assert.equal(existsSync(customerWeb), true);
    applyAppArtwork(root, 'tenant-a', tenant, BRAND, ['kiosk']);
    assert.equal(existsSync(customer), false);
    assert.equal(existsSync(customerWeb), false);
    assert.equal(
      readFileSync(join(root, 'apps', 'kiosk', 'assets', 'tenants', 'tenant-a', 'images', 'icon.png'), 'utf8'),
      'tenant-a',
    );
  });

  it('keeps each applied tenant artwork slot byte-for-byte', () => {
    const { root, tenant } = fixture();
    seedComplete(tenant);
    applyAppArtwork(root, 'tenant-a', tenant, BRAND, ['customer', 'kiosk']);
    const tenantB = join(root, 'tenants', 'tenant-b');
    seedComplete(tenantB, 'tenant-b');
    applyAppArtwork(root, 'tenant-b', tenantB, BRAND, ['customer', 'kiosk']);
    for (const app of ['customer', 'kiosk']) {
      const assets = join(root, 'apps', app, 'assets', 'tenants');
      assert.equal(readFileSync(join(assets, 'tenant-a', 'images', 'icon.png'), 'utf8'), 'tenant-a');
      assert.equal(readFileSync(join(assets, 'tenant-b', 'images', 'icon.png'), 'utf8'), 'tenant-b');
    }
  });
});
