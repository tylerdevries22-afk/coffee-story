import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { EMPTY_MENU_FACTS, resolveKioskFlow } from '@platform/domain';
import type { ConfigContext } from 'expo/config';

import kioskConfig from '../../app.config';
import TENANT from './brand.json';

/**
 * The kiosk bundles its own copy of the brand file for the same reason the
 * customer app does -- Metro cannot require a runtime-chosen path -- but for a
 * long time nothing wrote it and nothing pinned it. It fell a key behind
 * (`board`, added on main) without a single test going red.
 */
describe('bundled tenant config', () => {
  it('matches tenants/<slug>/brand.json exactly', () => {
    const source = JSON.parse(
      readFileSync(join(__dirname, `../../../../tenants/${TENANT.identity.slug}/brand.json`), 'utf8'),
    );
    const bundled = JSON.parse(readFileSync(join(__dirname, 'brand.json'), 'utf8'));
    assert.deepEqual(bundled, source, 'run `pnpm onboard --tenant <slug> --apply` to refresh the bundled copies');
  });

  it('carries everything the kiosk dereferences', () => {
    assert.ok(TENANT.identity.slug);
    assert.ok(TENANT.business.monogram.length >= 1 && TENANT.business.monogram.length <= 3);
    assert.equal(typeof TENANT.features.stored_value, 'boolean');
    assert.ok(TENANT.tokens.surface, 'the splash ground is read before the theme mounts');
  });

  it('derives the native identity from the bundled tenant', () => {
    const config = kioskConfig({ config: {} } as ConfigContext);
    assert.equal(config.name, `${TENANT.identity.name} Kiosk`);
    assert.equal(config.slug, `${TENANT.identity.slug}-kiosk`);
    assert.equal(config.scheme, TENANT.identity.kioskScheme);
    assert.equal(config.ios?.bundleIdentifier, TENANT.identity.kioskBundleId);
    assert.equal(config.android?.package, TENANT.identity.kioskBundleId);
  });

  it('ships only artwork generated from this tenant logo', () => {
    const generated = join(__dirname, `../../../../tenants/${TENANT.identity.slug}/app-store/generated`);
    const mappings = [
      ['icon.png', 'images/icon.png'],
      ['android-foreground.png', 'images/android-icon-foreground.png'],
      ['android-background.png', 'images/android-icon-background.png'],
      ['android-monochrome.png', 'images/android-icon-monochrome.png'],
      ['favicon.png', 'images/favicon.png'],
      ['splash-logo.png', 'brand/logo.png'],
    ] as const;
    for (const [source, destination] of mappings) {
      const generatedBytes = readFileSync(join(generated, source));
      const bundledBytes = readFileSync(join(__dirname, '../../assets', destination));
      assert.ok(bundledBytes.equals(generatedBytes), `${destination} has drifted from generated tenant artwork`);
    }
  });
});

describe('the kiosk flow this tenant ships', () => {
  /**
   * The zero-config contract, asserted against the real file rather than a
   * fixture: whatever the tenant did or did not configure, a device opens on
   * something a guest can press. Passing EMPTY_MENU_FACTS is the worst case --
   * a brand row seeded before its menu.
   */
  it('always yields a tappable first screen, even with no menu', () => {
    const flow = resolveKioskFlow(TENANT.kiosk, { menu: EMPTY_MENU_FACTS });
    assert.ok(flow.entry.nodes.length > 0);
    assert.ok(flow.entry.prompt.length > 0);
  });

  it('always offers a tender that can settle an order', () => {
    const flow = resolveKioskFlow(TENANT.kiosk, {
      menu: EMPTY_MENU_FACTS,
      features: { stored_value: TENANT.features.stored_value },
    });
    assert.ok(flow.tenders.length > 0);
  });
});
