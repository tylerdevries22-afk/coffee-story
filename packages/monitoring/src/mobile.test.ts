import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { initMobileMonitoring, mobileMonitoringEnabled } from './mobile';

describe('mobileMonitoringEnabled', () => {
  it('requires a DSN and refuses Expo Go', () => {
    assert.equal(mobileMonitoringEnabled(undefined, null), false);
    assert.equal(mobileMonitoringEnabled('https://public@example.test/1', 'expo'), false);
    assert.equal(mobileMonitoringEnabled('https://public@example.test/1', 'standalone'), true);
  });
});

describe('initMobileMonitoring', () => {
  it('is a safe no-op without a DSN', async () => {
    const previous = process.env.EXPO_PUBLIC_SENTRY_DSN;
    delete process.env.EXPO_PUBLIC_SENTRY_DSN;
    await assert.doesNotReject(initMobileMonitoring());
    if (previous) process.env.EXPO_PUBLIC_SENTRY_DSN = previous;
  });
});
