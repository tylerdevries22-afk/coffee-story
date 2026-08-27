import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { analyticsOriginAllowed } from './analytics-origin';

describe('analyticsOriginAllowed', () => {
  const requestUrl = 'https://hq.example.com/api/analytics/events';

  it('allows native requests, same-origin HQ, and exact configured app origins', () => {
    assert.equal(analyticsOriginAllowed(requestUrl, null, undefined), true);
    assert.equal(analyticsOriginAllowed(requestUrl, 'https://hq.example.com', undefined), true);
    assert.equal(analyticsOriginAllowed(requestUrl, 'https://kiosk.example.com', 'https://customer.example.com,https://kiosk.example.com'), true);
  });

  it('rejects lookalike, path-bearing, and unconfigured browser origins', () => {
    assert.equal(analyticsOriginAllowed(requestUrl, 'https://hq.example.com.attacker.test', undefined), false);
    assert.equal(analyticsOriginAllowed(requestUrl, 'https://kiosk.example.com/path', 'https://kiosk.example.com'), false);
    assert.equal(analyticsOriginAllowed(requestUrl, 'https://customer.example.com', undefined), false);
  });
});
