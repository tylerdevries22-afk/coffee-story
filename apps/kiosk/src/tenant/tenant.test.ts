import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { EMPTY_MENU_FACTS, resolveKioskFlow } from '@platform/domain';
import { STOREFRONT_CAPABILITY_MODULE } from '@platform/module-kit';
import type { ConfigContext } from 'expo/config';

import kioskConfig, { kioskEasConfig } from '../../app.config';

import { TENANT, TENANT_SLUG } from './index';
import { TENANT_MODULE_KEYS, kioskCapability } from './capabilities';

const SLOTS = join(__dirname, '..', 'tenants');
const TENANTS = join(__dirname, '../../../../tenants');

function readJson(...segments: string[]): unknown {
  return JSON.parse(readFileSync(join(...segments), 'utf8'));
}

describe('the selected tenant', () => {
  it('selects one of the applied tenants, and only one', () => {
    // The barrel resolves the slug once, from EXPO_PUBLIC_TENANT, and throws
    // rather than guessing when several tenants are applied.
    const applied = (JSON.parse(
      readFileSync(join(__dirname, '..', 'tenants', 'applied.json'), 'utf8'),
    ) as { slugs: string[] }).slugs;
    assert.ok(applied.includes(TENANT_SLUG), `${TENANT_SLUG} is not applied`);
    assert.equal(TENANT.identity.slug, TENANT_SLUG);
  });

  it('gates stored value on the module, not on the brand.json flag', () => {
    assert.equal(
      kioskCapability('stored_value'),
      TENANT_MODULE_KEYS.includes(STOREFRONT_CAPABILITY_MODULE.stored_value),
    );
  });

  it('carries everything the kiosk dereferences', () => {
    assert.ok(TENANT.identity.slug);
    assert.ok(TENANT.business.monogram.length >= 1 && TENANT.business.monogram.length <= 3);
    assert.equal(typeof TENANT.features.stored_value, 'boolean');
    assert.ok(TENANT.tokens?.surface, 'the splash ground is read before the theme mounts');
  });

  it('derives the native identity from the selected tenant', () => {
    // app.config.ts resolves the slug by the same rule the bundle does. If the
    // two ever disagreed, a build would carry one shop's name over another
    // shop's menu -- correctly signed, and silent.
    const config = kioskConfig({ config: {} } as ConfigContext);
    assert.equal(config.name, `${TENANT.identity.name} Kiosk`);
    assert.equal(config.slug, `${TENANT_SLUG}-kiosk`);
    assert.equal(config.scheme, TENANT.identity.kioskScheme);
    assert.equal(config.ios?.bundleIdentifier, TENANT.identity.kioskBundleId);
    assert.equal(config.ios?.icon, './assets/expo.icon');
    assert.equal(config.android?.package, TENANT.identity.kioskBundleId);
    assert.equal(config.android?.adaptiveIcon?.backgroundImage, './assets/images/android-icon-background.png');
    // An empty project id is valid until this tenant's kiosk runs `eas init`,
    // which is the state a franchisee is in on the day they are applied.
    const projectId = TENANT.identity.kioskEasProjectId;
    if (projectId === '') {
      assert.equal(config.extra?.eas, undefined);
      assert.equal(config.updates, undefined);
    } else {
      assert.equal(config.extra?.eas?.projectId, projectId);
      assert.equal(config.updates?.url, `https://u.expo.dev/${projectId}`);
    }
  });

  it('omits EAS updates until a tenant kiosk has its own project', () => {
    assert.deepEqual(kioskEasConfig(''), { extra: { router: {} } });
    assert.deepEqual(kioskEasConfig('   '), { extra: { router: {} } });
  });

  it('ships only artwork generated from its logo', () => {
    // Single-slot on purpose: app.config.ts and the native build name these at
    // fixed paths and one binary carries one icon, so this asserts the selected
    // slug rather than every applied one.
    //
    // A tenant that has not supplied a logo has no generated artwork, and the
    // app keeps whatever the last tenant with one applied. That is a real gap
    // in a franchisee's onboarding, so it is asserted as such rather than
    // silently passing: the artwork must belong to SOME applied tenant.
    const generated = join(TENANTS, TENANT_SLUG, 'app-store/generated');
    if (!existsSync(generated)) {
      const applied = (JSON.parse(
        readFileSync(join(__dirname, '..', 'tenants', 'applied.json'), 'utf8'),
      ) as { slugs: string[] }).slugs;
      const owner = applied.find((slug) => existsSync(join(TENANTS, slug, 'app-store/generated')));
      assert.ok(
        owner,
        `no applied tenant has generated artwork; add tenants/${TENANT_SLUG}/assets/logo.png and re-apply`,
      );
      return;
    }
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
      assert.ok(
        readFileSync(join(__dirname, '../../assets', destination)).equals(readFileSync(join(generated, source))),
        `${destination} has drifted from generated tenant artwork`,
      );
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
    const menu = readJson(SLOTS, TENANT_SLUG, 'menu.json') as { items: readonly { id: string }[] };
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
