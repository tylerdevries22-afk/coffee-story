import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { plannedExports, requiredTenant } from './build-org-web-statics';

const own = () => 'coffee-story';
const applied = () => ['coffee-story', 'stillpoint-builders'];
const shape = (plan: ReturnType<typeof plannedExports>) =>
  plan.map(({ surface, tenant, target }) => `${tenant} ${surface.baseUrl} ${target.split(join('apps', 'hq', 'public'))[1]}`);

describe('plannedExports', () => {
  it('writes the three Model B paths for the deployment tenant by default', () => {
    assert.deepEqual(shape(plannedExports([], own, applied)), [
      `coffee-story /customer ${join('/', 'customer')}`,
      `coffee-story /kiosk ${join('/', 'kiosk')}`,
      `coffee-story /operator ${join('/', 'operator')}`,
    ]);
  });

  it('keeps the Model B paths when --wall adds the per-tenant copies', () => {
    // The regression this guards: --wall used to return after the wall loop,
    // so production would have lost /customer, /kiosk and /operator.
    const plan = shape(plannedExports(['--wall'], own, applied));
    assert.equal(plan.length, 9);
    assert.deepEqual(plan.slice(-3), shape(plannedExports([], own, applied)));
    assert.ok(plan.includes(
      `stillpoint-builders /t/stillpoint-builders/kiosk ${join('/', 't', 'stillpoint-builders', 'kiosk')}`,
    ));
  });

  it('builds each wall copy with that tenant, never the deployment tenant', () => {
    const wall = plannedExports(['--wall'], own, applied).slice(0, 6);
    for (const entry of wall) {
      assert.ok(entry.surface.baseUrl.startsWith(`/t/${entry.tenant}/`), entry.surface.baseUrl);
    }
  });

  it('fails on a missing tenant before exporting any wall copy', () => {
    let listed = false;
    assert.throws(
      () => plannedExports(['--wall'], () => { throw new Error('no tenant'); }, () => { listed = true; return []; }),
      /no tenant/,
    );
    assert.equal(listed, false);
  });

  it('writes nothing with --skip', () => {
    assert.deepEqual(plannedExports(['--skip', '--wall'], own, applied), []);
  });
});

describe('requiredTenant', () => {
  it('fails closed when the tenant slug is unset', () => {
    const prevT = process.env.EXPO_PUBLIC_TENANT;
    const prev = process.env.TENANT;
    delete process.env.EXPO_PUBLIC_TENANT;
    delete process.env.TENANT;
    try {
      assert.throws(requiredTenant, /refusing to default to coffee-story/);
    } finally {
      if (prevT !== undefined) process.env.EXPO_PUBLIC_TENANT = prevT;
      else delete process.env.EXPO_PUBLIC_TENANT;
      if (prev !== undefined) process.env.TENANT = prev;
      else delete process.env.TENANT;
    }
  });

  it('keeps an explicit coffee-story slug', () => {
    const prevT = process.env.EXPO_PUBLIC_TENANT;
    process.env.EXPO_PUBLIC_TENANT = 'coffee-story';
    try {
      assert.equal(requiredTenant(), 'coffee-story');
    } finally {
      if (prevT !== undefined) process.env.EXPO_PUBLIC_TENANT = prevT;
      else delete process.env.EXPO_PUBLIC_TENANT;
    }
  });

  it('falls back to TENANT when EXPO_PUBLIC_TENANT is unset', () => {
    const prevT = process.env.EXPO_PUBLIC_TENANT;
    const prev = process.env.TENANT;
    delete process.env.EXPO_PUBLIC_TENANT;
    process.env.TENANT = 'coffee-story';
    try {
      assert.equal(requiredTenant(), 'coffee-story');
    } finally {
      if (prevT !== undefined) process.env.EXPO_PUBLIC_TENANT = prevT;
      else delete process.env.EXPO_PUBLIC_TENANT;
      if (prev !== undefined) process.env.TENANT = prev;
      else delete process.env.TENANT;
    }
  });
});
