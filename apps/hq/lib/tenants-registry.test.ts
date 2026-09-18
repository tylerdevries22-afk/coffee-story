/**
 * The organization switcher is built from the generated registry, so what these
 * pin is the part that is still a decision rather than a scan: the order, whose
 * first entry callers fall back to as the demo default, and the launch
 * tenant's fixtures. Everything else about an org must come from its folder.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DEMO_LOCATIONS, DEMO_SESSION } from './demo-data';
import { switcherOrder, TENANT_ORGS, tenantOrgById } from './tenants';
import { GENERATED_TENANTS } from './tenants.generated';

describe('tenant registry', () => {
  it('lists every generated tenant folder exactly once', () => {
    assert.deepEqual(
      TENANT_ORGS.map((org) => org.slug).sort(),
      GENERATED_TENANTS.map((tenant) => tenant.slug).sort(),
    );
  });

  it('keeps the switcher order it had when the list was hand-written', () => {
    assert.deepEqual(TENANT_ORGS.slice(0, 5).map((org) => org.slug), [
      'stillpoint-builders', 'coffee-story', 'juniper-base-demo', 'actz', 'summit-ridge-hotels',
    ]);
  });

  it('puts a tenant the order does not name after the named ones, alphabetically', () => {
    const order = switcherOrder([
      { slug: 'zeta-shop' }, { slug: 'actz' }, { slug: 'alpha-shop' },
      { slug: 'coffee-story' }, { slug: 'stillpoint-builders' },
    ]).map((tenant) => tenant.slug);
    assert.deepEqual(order, ['stillpoint-builders', 'coffee-story', 'actz', 'alpha-shop', 'zeta-shop']);
  });

  it('keeps the launch tenant on the demo session id and its fixture locations', () => {
    const launch = tenantOrgById(DEMO_SESSION.brandId);
    assert.equal(launch?.slug, 'coffee-story');
    assert.deepEqual(launch?.locations, DEMO_LOCATIONS.map((location) => ({
      id: location.id,
      name: location.name,
      city: location.city,
      timezone: location.timezone,
      hours: location.hours,
    })));
  });

  it('identifies every other tenant by slug, named and themed from its brand.json', () => {
    for (const tenant of GENERATED_TENANTS) {
      const org = TENANT_ORGS.find((candidate) => candidate.slug === tenant.slug);
      assert.ok(org, `${tenant.slug} is not registered`);
      assert.equal(org.name, tenant.brand.identity.name, tenant.slug);
      assert.equal(org.brandConfig, tenant.brand, tenant.slug);
      if (tenant.slug !== 'coffee-story') assert.equal(org.id, tenant.slug);
    }
  });
});
