import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { requiredTenant } from './build-org-web-statics';

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
});
