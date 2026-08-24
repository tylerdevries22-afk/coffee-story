import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { EMPTY_MENU_FACTS, resolveKioskFlow } from '@platform/domain';
import type { ConfigContext } from 'expo/config';

import kioskConfig, { kioskEasConfig } from '../../app.config';
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

  it('bundles the same generated tenant menu as the customer app', () => {
    const kioskMenu = JSON.parse(readFileSync(join(__dirname, 'menu.json'), 'utf8'));
    const customerMenu = JSON.parse(readFileSync(join(__dirname, '../../../customer/src/tenant/menu.json'), 'utf8'));
    assert.deepEqual(kioskMenu, customerMenu, 'run onboarding with --apply to refresh both offline catalogs');
  });

  it('bundles the same generated menu-media map and WebP bytes as the customer app', () => {
    const kioskMedia = readFileSync(join(__dirname, 'menu-media.ts'), 'utf8');
    const customerMedia = readFileSync(join(__dirname, '../../../customer/src/tenant/menu-media.ts'), 'utf8');
    assert.equal(kioskMedia, customerMedia, 'generated static image maps have drifted');

    const sourceMenu = join(__dirname, `../../../../tenants/${TENANT.identity.slug}/assets/menu`);
    const kioskMenu = join(__dirname, '../../assets/menu');
    const customerMenu = join(__dirname, '../../../customer/assets/menu');
    const webps = (directory: string) => readdirSync(directory).filter((name) => name.endsWith('.webp')).sort();
    const expected = webps(sourceMenu);
    assert.deepEqual(webps(kioskMenu), expected, 'kiosk menu filenames have drifted from tenant source');
    assert.deepEqual(webps(customerMenu), expected, 'customer menu filenames have drifted from tenant source');
    for (const filename of expected) {
      const sourceBytes = readFileSync(join(sourceMenu, filename));
      assert.ok(readFileSync(join(kioskMenu, filename)).equals(sourceBytes), `${filename} differs in the kiosk bundle`);
      assert.ok(readFileSync(join(customerMenu, filename)).equals(sourceBytes), `${filename} differs in the customer bundle`);
    }
  });

  it('maps every bundled menu item to one statically importable WebP', () => {
    const menu = JSON.parse(readFileSync(join(__dirname, 'menu.json'), 'utf8')) as {
      items: readonly { id: string }[];
    };
    const media = readFileSync(join(__dirname, 'menu-media.ts'), 'utf8');
    const mappedSlugs = [...media.matchAll(/^\s*'([^']+)':\s*menu\w+,?$/gm)]
      .map((match) => match[1])
      .filter((slug): slug is string => slug !== undefined)
      .sort();
    assert.deepEqual(mappedSlugs, menu.items.map((item) => item.id).sort());
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
    assert.equal(config.ios?.icon, './assets/expo.icon');
    assert.equal(config.android?.package, TENANT.identity.kioskBundleId);
    assert.equal(config.android?.adaptiveIcon?.backgroundImage, './assets/images/android-icon-background.png');
    assert.equal(config.extra?.eas?.projectId, TENANT.identity.kioskEasProjectId);
    assert.equal(config.updates?.url, `https://u.expo.dev/${TENANT.identity.kioskEasProjectId}`);
  });

  it('omits EAS updates until a tenant kiosk has its own project', () => {
    assert.deepEqual(kioskEasConfig(''), { extra: { router: {} } });
    assert.deepEqual(kioskEasConfig('   '), { extra: { router: {} } });
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
      ['android-foreground.png', 'expo.icon/Assets/mark.png'],
    ] as const;
    for (const [source, destination] of mappings) {
      const generatedBytes = readFileSync(join(generated, source));
      const bundledBytes = readFileSync(join(__dirname, '../../assets', destination));
      assert.ok(bundledBytes.equals(generatedBytes), `${destination} has drifted from generated tenant artwork`);
    }
    assert.ok(
      readFileSync(join(__dirname, '../../assets/expo.icon/icon.json'))
        .equals(readFileSync(join(__dirname, '../../../customer/assets/expo.icon/icon.json'))),
      'customer and kiosk Expo icon configurations have drifted',
    );
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

  it('gives every curated entry tile a bundled menu photograph', () => {
    const flow = resolveKioskFlow(TENANT.kiosk, { menu: EMPTY_MENU_FACTS });
    const menu = JSON.parse(readFileSync(join(__dirname, 'menu.json'), 'utf8')) as {
      items: readonly { id: string }[];
    };
    const itemSlugs = new Set(menu.items.map((item) => item.id));
    for (const node of flow.entry.nodes) {
      assert.ok(node.imageSlug, `${node.id} has no curated imageSlug`);
      assert.ok(itemSlugs.has(node.imageSlug), `${node.id} points at missing menu art ${node.imageSlug}`);
    }
  });

  it('always offers a tender that can settle an order', () => {
    const flow = resolveKioskFlow(TENANT.kiosk, {
      menu: EMPTY_MENU_FACTS,
      features: { stored_value: TENANT.features.stored_value },
    });
    assert.ok(flow.tenders.includes('cash'),
      'the paired kiosk needs a real pay-at-counter path until the native reader is provisioned');
  });
});
