import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { TENANT } from './index';

describe('bundled tenant config', () => {
  it('matches tenants/<slug>/brand.json exactly', () => {
    // The app bundles a copy (Metro cannot require a runtime-chosen path);
    // onboarding refreshes it. A drifted copy ships the wrong brand.
    const source = JSON.parse(
      readFileSync(join(__dirname, `../../../../tenants/${TENANT.identity.slug}/brand.json`), 'utf8'),
    );
    const bundled = JSON.parse(readFileSync(join(__dirname, 'brand.json'), 'utf8'));
    assert.deepEqual(bundled, source);
  });

  it('carries everything the app dereferences', () => {
    assert.ok(TENANT.identity.slug);
    assert.ok(TENANT.identity.bundleId.includes('.'));
    assert.ok(TENANT.business.monogram.length >= 1 && TENANT.business.monogram.length <= 3);
    assert.equal(typeof TENANT.features.drops, 'boolean');
    assert.ok(TENANT.location.timezone.includes('/'));
  });

  it('ships the tenant-owned customer media byte for byte', () => {
    const assetGroups = [
      { name: 'menu', extensions: ['.webp', '.normalized.json'] },
      { name: 'gift', extensions: ['.webp', '.png'] },
      { name: 'hero', extensions: ['.webp', '.png', '.mp4'] },
      { name: 'rewards', extensions: ['.webp', '.png'] },
    ];
    for (const group of assetGroups) {
      const tenantAssets = join(__dirname, `../../../../tenants/${TENANT.identity.slug}/assets/${group.name}`);
      const bundledAssets = join(__dirname, `../../assets/${group.name}`);
      const files = readdirSync(tenantAssets)
        .filter((file) => group.extensions.some((extension) => file.endsWith(extension)))
        .sort();
      const bundledFiles = readdirSync(bundledAssets)
        .filter((file) => group.extensions.some((extension) => file.endsWith(extension)))
        .sort();
      assert.deepEqual(bundledFiles, files, `${group.name} contains stale or missing tenant media`);
      for (const file of files) {
        const source = readFileSync(join(tenantAssets, file));
        const bundled = readFileSync(join(bundledAssets, file));
        assert.ok(bundled.equals(source), `${group.name}/${file} has drifted from the tenant folder`);
      }
    }
  });

  it('ships only artwork generated from this tenant logo', () => {
    const generated = join(__dirname, `../../../../tenants/${TENANT.identity.slug}/app-store/generated`);
    const mappings = [
      ['icon.png', '../../assets/images/icon.png'],
      ['android-foreground.png', '../../assets/images/android-icon-foreground.png'],
      ['android-background.png', '../../assets/images/android-icon-background.png'],
      ['android-monochrome.png', '../../assets/images/android-icon-monochrome.png'],
      ['favicon.png', '../../assets/images/favicon.png'],
      ['splash-logo.png', '../../assets/brand/logo.png'],
      ['icon.png', '../../public/icon.png'],
      ['icon-180.png', '../../public/icon-180.png'],
    ] as const;
    for (const [source, destination] of mappings) {
      assert.ok(
        readFileSync(join(__dirname, destination)).equals(readFileSync(join(generated, source))),
        `${destination} has drifted from generated tenant artwork`,
      );
    }
  });
});

describe('bundled product cut-outs', () => {
  const productsDir = join(__dirname, '../../assets/products');
  const tenantDir = join(__dirname, `../../../../tenants/${TENANT.identity.slug}/assets/products`);

  // Read as text rather than imported: `product-media.ts` imports .webp assets,
  // which `node:test` cannot transform. The same technique the screen tests use.
  const generated = readFileSync(join(__dirname, 'product-media.ts'), 'utf8');
  const mapped = [...generated.matchAll(/^  '([a-z0-9-]+)':/gm)].map((match) => match[1]).sort();
  const seated = readdirSync(tenantDir)
    .filter((file) => file.endsWith('.webp'))
    .map((file) => file.replace(/\.webp$/, ''))
    .sort();

  it('maps exactly the cut-outs the tenant has seated', () => {
    // Same reason brand.json is copied: Metro cannot require a runtime-chosen
    // path, so `pnpm onboard --apply` materialises the choice. A stale map
    // either ships one brand's glassware in another brand's binary, or names an
    // asset that is not there -- which fails the bundle, not the tests.
    assert.deepEqual(mapped, seated);
  });

  it('ships no stale cut-outs from another tenant', () => {
    const bundled = readdirSync(productsDir)
      .filter((file) => file.endsWith('.webp'))
      .map((file) => file.replace(/\.webp$/, ''))
      .sort();
    assert.deepEqual(bundled, seated);
  });

  it('matches the tenant folder byte for byte', () => {
    for (const slug of seated) {
      const bundled = readFileSync(join(productsDir, `${slug}.webp`));
      const source = readFileSync(join(tenantDir, `${slug}.webp`));
      assert.ok(bundled.equals(source), `${slug}.webp has drifted from the tenant folder`);
    }
  });

  it('carries alpha, which is the entire point of the asset class', () => {
    // A simple lossy WebP is `VP8 ` and cannot hold an alpha channel; an
    // extended one is `VP8X`. A flattened cut-out still looks plausible in a
    // diff, so the format is asserted rather than trusted.
    for (const slug of seated) {
      const bytes = readFileSync(join(productsDir, `${slug}.webp`));
      assert.equal(bytes.subarray(12, 16).toString('ascii'), 'VP8X', `${slug}.webp lost its transparency`);
    }
  });
});
