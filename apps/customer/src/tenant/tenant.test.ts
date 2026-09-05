import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  STOREFRONT_CAPABILITIES,
  STOREFRONT_CAPABILITY_MODULE,
} from '@platform/module-kit';

import {
  normalizeTenantAddress,
  TENANT,
  TENANT_MODULE_KEYS,
  TENANT_SLUG,
  tenantFeature,
} from './index';

const TENANTS = join(__dirname, '../../../../tenants');

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

  it('resolves every storefront capability from the manifest, not from brand.json', () => {
    // brand.json still carries a `features` block for onboarding's own use;
    // nothing on this path reads it any more.
    for (const capability of STOREFRONT_CAPABILITIES) {
      assert.equal(
        tenantFeature(capability),
        TENANT_MODULE_KEYS.includes(STOREFRONT_CAPABILITY_MODULE[capability]),
        `${capability} does not follow its module`,
      );
    }
  });

  it('carries everything the app dereferences', () => {
    assert.ok(TENANT.identity.slug);
    assert.ok(TENANT.identity.bundleId.includes('.'));
    assert.ok(TENANT.business.monogram.length >= 1 && TENANT.business.monogram.length <= 3);
    assert.equal(typeof TENANT.features.drops, 'boolean');
    assert.ok(TENANT.location.timezone.includes('/'));
  });

  it('normalizes canonical and legacy tenant address fields', () => {
    assert.deepEqual(
      normalizeTenantAddress({ street: '100 Market Street', city: 'Riverside', region: 'CO', postal: '80000' }),
      { street: '100 Market Street', city: 'Riverside', region: 'CO', postal: '80000' },
    );
    assert.deepEqual(
      normalizeTenantAddress({ line1: '1 Main Street', postalCode: '10001' }),
      { street: '1 Main Street', city: '', region: '', postal: '10001' },
    );
  });

  it('ships only artwork generated from its logo', () => {
    // One binary carries one icon, but every applied tenant has its own source
    // slot so selecting another brand never overwrites this one's release input.
    const generated = join(TENANTS, TENANT_SLUG, 'app-store/generated');
    if (!existsSync(generated)) {
      const applied = (JSON.parse(
        readFileSync(join(__dirname, '..', 'tenants', 'applied.json'), 'utf8'),
      ) as { slugs: string[] }).slugs;
      assert.ok(
        applied.some((slug) => existsSync(join(TENANTS, slug, 'app-store/generated'))),
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
    ] as const;
    for (const [source, destination] of mappings) {
      assert.ok(
        readFileSync(join(__dirname, '../../assets/tenants', TENANT_SLUG, destination))
          .equals(readFileSync(join(generated, source))),
        `${destination} has drifted from generated tenant artwork`,
      );
    }
    for (const name of ['icon.png', 'icon-180.png']) {
      assert.ok(
        readFileSync(join(__dirname, '../../public/tenants', TENANT_SLUG, name))
          .equals(readFileSync(join(generated, name))),
        `${name} has drifted from generated tenant web artwork`,
      );
    }
  });
});
