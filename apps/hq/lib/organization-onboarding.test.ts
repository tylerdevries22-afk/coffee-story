import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MODULE_REGISTRY } from '@platform/module-kit';

import {
  eligibleModuleKeys,
  INDUSTRY_OPTIONS,
  MODULE_OPTIONS,
  MODULE_TIERS,
  moduleOptionsForIndustry,
  requiredBySelection,
  resolvedModuleSelection,
} from './organization-onboarding';

const keysFor = (industry: 'general' | 'coffee-shop' | 'construction') => (
  eligibleModuleKeys(industry)
);

describe('organization module onboarding', () => {
  it('represents every registry module exactly once', () => {
    assert.deepEqual(
      MODULE_OPTIONS.map((module) => module.key),
      MODULE_REGISTRY.map((module) => module.key),
    );
    assert.equal(new Set(MODULE_OPTIONS.map((module) => module.key)).size, MODULE_OPTIONS.length);
  });

  it('organizes every option into Base, Plus, or Premium', () => {
    assert.deepEqual(MODULE_TIERS.map((tier) => tier.label), ['Base model', 'Plus model', 'Premium']);
    const tiers = new Set(MODULE_TIERS.map((tier) => tier.key));
    assert.ok(MODULE_OPTIONS.every((module) => tiers.has(module.tier)));
  });

  it('keeps hospitality and construction modules industry-specific', () => {
    const hospitality = keysFor('coffee-shop');
    const construction = keysFor('construction');

    assert.equal(hospitality.includes('construction-projects'), false);
    assert.ok(hospitality.includes('growth-loyalty'));
    assert.ok(hospitality.includes('commerce-catering'));
    assert.ok(construction.includes('construction-projects'));
    assert.equal(construction.includes('growth-loyalty'), false);
    assert.equal(construction.includes('commerce-catering'), false);
  });

  it('shows only generic modules for a general organization', () => {
    assert.deepEqual(keysFor('general'), [
      'commerce-catalog', 'commerce-ordering', 'commerce-payments',
      'workforce-operations', 'workforce-training', 'local-printing', 'device-wall',
    ]);
  });

  it('keeps every industry recommendation eligible', () => {
    for (const industry of INDUSTRY_OPTIONS) {
      const eligible = new Set(keysFor(industry.key));
      assert.ok(industry.suggestedModules.every((key) => eligible.has(key)));
    }
  });

  it('keeps every eligible dependency inside the same industry boundary', () => {
    for (const industry of INDUSTRY_OPTIONS) {
      const eligible = new Set(keysFor(industry.key));
      for (const module of moduleOptionsForIndustry(industry.key)) {
        assert.ok(module.dependencies.every((dependency) => eligible.has(dependency)));
      }
    }
  });

  it('keeps the UI projection aligned with the reusable eligibility policy', () => {
    for (const industry of INDUSTRY_OPTIONS) {
      assert.deepEqual(
        moduleOptionsForIndustry(industry.key).map((module) => module.key),
        eligibleModuleKeys(industry.key),
      );
    }
  });

  it('expands dependencies into the exact selection displayed to the user', () => {
    assert.deepEqual(resolvedModuleSelection('coffee-shop', ['commerce-payments']), [
      'commerce-catalog', 'commerce-ordering', 'commerce-payments',
    ]);
    assert.deepEqual(requiredBySelection('coffee-shop', [
      'commerce-catalog', 'commerce-ordering', 'commerce-payments',
    ], 'commerce-ordering'), ['Payments']);
  });
});
