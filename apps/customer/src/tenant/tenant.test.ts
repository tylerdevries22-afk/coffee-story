import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  STOREFRONT_CAPABILITIES,
  STOREFRONT_CAPABILITY_MODULE,
} from '@platform/module-kit';

import { TENANT, TENANT_MODULE_KEYS, TENANT_SLUG, tenantFeature } from './index';

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

  it('ships only artwork generated from its logo', () => {
    // Single-slot, and deliberately so: app.config.ts and the native build name
    // these at fixed paths, and one binary carries one icon. Applying a second
    // tenant replaces them, which is why this asserts the selected slug only.
    //
    // A tenant that supplied no logo has no generated artwork, and this build
    // keeps whichever tenant's icons were applied last -- a real onboarding gap
    // for a franchisee, so it is named rather than silently passed over.
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
