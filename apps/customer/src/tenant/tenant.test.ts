import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
});
