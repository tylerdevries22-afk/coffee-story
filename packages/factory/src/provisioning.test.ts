import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  FACTORY_SCHEMA_VERSION,
  createProvisioningPlan,
  factoryTasks,
  parseOnboardingIntake,
  runnableTaskKeys,
  validateIndustryBlueprint,
  type FactoryTaskSnapshot,
  type IndustryBlueprint,
} from './index';

const blueprint: IndustryBlueprint = {
  schemaVersion: FACTORY_SCHEMA_VERSION,
  key: 'coffee-shop',
  name: 'Coffee shop',
  templateVersion: 1,
  locale: 'en-US',
  supabaseRegion: 'us-west-1',
  vocabulary: { offering: 'Menu item' },
};

describe('factory onboarding intake', () => {
  it('accepts a complete industry-neutral intake', () => {
    const result = parseOnboardingIntake({ businessName: 'Juniper Coffee', tenantSlug: 'juniper-coffee', industryKey: 'coffee-shop', websiteUrl: 'https://juniper.example', locationName: 'Downtown', timezone: 'America/Denver' });
    assert.equal(result.ok, true);
  });

  it('rejects unsafe URLs, invalid slugs, and incomplete locations', () => {
    const result = parseOnboardingIntake({ businessName: 'J', tenantSlug: '../coffee', industryKey: 'Coffee', websiteUrl: 'http://example.com', locationName: '', timezone: 'Denver' });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.deepEqual(result.issues, [
        'Business name must be 2 to 120 characters.',
        'Tenant slug must be lowercase words separated by hyphens.',
        'Industry key must be a valid slug.',
        'Location name must be 2 to 120 characters.',
        'Timezone must be an IANA timezone such as America/Denver.',
        'Website URL must use HTTPS.',
      ]);
    }
  });
});

describe('industry blueprint and plan', () => {
  it('validates the versioned reusable blueprint', () => {
    assert.equal(validateIndustryBlueprint(blueprint).ok, true);
  });

  it('creates a deterministic dependency-safe plan', () => {
    const intake = parseOnboardingIntake({ businessName: 'Juniper Coffee', tenantSlug: 'juniper-coffee', industryKey: 'coffee-shop', locationName: 'Downtown', timezone: 'America/Denver' });
    assert.equal(intake.ok, true);
    if (!intake.ok) return;
    const plan = createProvisioningPlan(blueprint, intake.value);
    assert.equal(plan.tasks.length, 11);
    assert.deepEqual(plan.tasks[0]?.dependsOn, []);
    assert.deepEqual(plan.tasks.at(-1)?.dependsOn, ['verify-canary']);
  });

  it('returns only tasks whose dependencies completed', () => {
    const tasks = factoryTasks();
    const snapshots: FactoryTaskSnapshot[] = tasks.map((task) => ({ key: task.key, state: task.key === 'research-brand' ? 'completed' : 'pending', attemptCount: 0 }));
    const plan = { schemaVersion: FACTORY_SCHEMA_VERSION, industryKey: 'coffee-shop', tenantSlug: 'juniper-coffee', tasks } as const;
    assert.deepEqual(runnableTaskKeys(plan, snapshots), ['generate-demo']);
  });
});
