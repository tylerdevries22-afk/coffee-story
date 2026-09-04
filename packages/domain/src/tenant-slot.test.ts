import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { appliedTenantSlugs, selectTenantSlot } from './tenant-slot';

const A = { slug: 'brand-a' };
const B = { slug: 'brand-b' };

describe('selectTenantSlot', () => {
  it('resolves the only applied tenant with no env at all', () => {
    assert.equal(selectTenantSlot({ app: 'customer', slots: { 'brand-a': A } }), A);
  });

  it('resolves the requested tenant when several are applied', () => {
    const slots = { 'brand-a': A, 'brand-b': B };
    assert.equal(selectTenantSlot({ app: 'customer', slots, requested: 'brand-b' }), B);
  });

  it('throws naming every applied slug when several are applied and none is requested', () => {
    // The failure this whole layout exists to prevent: a build that picks a
    // tenant for you ships one shop's menu under another shop's name.
    assert.throws(
      () => selectTenantSlot({ app: 'kiosk', slots: { 'brand-a': A, 'brand-b': B } }),
      (error: Error) => {
        assert.match(error.message, /apps\/kiosk bundles 2 tenants \(brand-a, brand-b\)/);
        assert.match(error.message, /EXPO_PUBLIC_TENANT/);
        return true;
      },
    );
  });

  it('throws for a tenant that is not applied rather than falling back', () => {
    assert.throws(
      () => selectTenantSlot({ app: 'customer', slots: { 'brand-a': A }, requested: 'brand-b' }),
      /EXPO_PUBLIC_TENANT="brand-b" is not applied to apps\/customer\. Applied: brand-a/,
    );
  });

  it('throws when nothing is applied', () => {
    assert.throws(
      () => selectTenantSlot({ app: 'customer', slots: {} }),
      /has no tenant applied/,
    );
  });

  it('treats blank and whitespace env as unset', () => {
    assert.equal(selectTenantSlot({ app: 'customer', slots: { 'brand-a': A }, requested: '  ' }), A);
    assert.equal(selectTenantSlot({ app: 'customer', slots: { 'brand-a': A }, requested: '' }), A);
  });

  it('trims a slug pasted with surrounding whitespace', () => {
    const slots = { 'brand-a': A, 'brand-b': B };
    assert.equal(selectTenantSlot({ app: 'customer', slots, requested: ' brand-b ' }), B);
  });

  it('sorts applied slugs so messages and tests read the same order', () => {
    assert.deepEqual(appliedTenantSlugs({ 'brand-b': B, 'brand-a': A }), ['brand-a', 'brand-b']);
  });

  it('refuses a prototype-chain key instead of resolving one', () => {
    // `slots['constructor']` walks the prototype chain to `Object`, which is
    // truthy, so a bare index accepted it and returned a slot whose slug was
    // undefined -- a build that did not fail loudly, which is the whole point.
    for (const hostile of ['__proto__', 'constructor', 'toString', 'valueOf', 'hasOwnProperty']) {
      assert.throws(
        () => selectTenantSlot({ app: 'customer', slots: { 'brand-a': A }, requested: hostile }),
        /is not applied to apps\/customer/,
        hostile,
      );
    }
  });

  it('refuses a slug onboarding would never have written', () => {
    for (const malformed of ['Brand-A', 'brand_a', '../brand-a', 'brand a', '-brand', 'brand-']) {
      assert.throws(
        () => selectTenantSlot({ app: 'customer', slots: { 'brand-a': A }, requested: malformed }),
        /is not applied/,
        malformed,
      );
    }
  });

  it('never reports an inherited property as applied', () => {
    assert.deepEqual(appliedTenantSlugs({ 'brand-a': A }), ['brand-a']);
  });
});
