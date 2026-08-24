/**
 * The ordering API surface and the Square webhook endpoint. The webhook
 * check asserts the endpoint *rejects* an unsigned request -- a 200 there
 * would mean signature verification is off, which is the outage that
 * matters.
 */
import { ApiCheck, AssertionBuilder } from 'checkly/constructs';

import { alertChannels } from '../checkly.config';

const base = '{{PLATFORM_BASE_URL}}';
const displayBase = '{{DISPLAY_BASE_URL}}';

new ApiCheck('hq-console-up', {
  name: 'HQ console responds',
  request: {
    method: 'GET',
    url: `${base}/`,
    followRedirects: true,
    assertions: [AssertionBuilder.statusCode().equals(200)],
  },
  alertChannels,
});

new ApiCheck('platform-deep-health', {
  name: 'HQ database dependency is healthy',
  request: {
    method: 'GET',
    url: `${base}/api/health?deep=1`,
    headers: [{ key: 'x-health-check-token', value: '{{HEALTH_CHECK_TOKEN}}' }],
    assertions: [
      AssertionBuilder.statusCode().equals(200),
      AssertionBuilder.jsonBody('$.ok').equals(true),
    ],
  },
  alertChannels,
});

new ApiCheck('pickup-display-up', {
  name: 'Pickup display board responds',
  request: {
    method: 'GET',
    url: `${displayBase}/board/{{DISPLAY_CHECK_LOCATION_ID}}`,
    followRedirects: false,
    assertions: [AssertionBuilder.statusCode().equals(200)],
  },
  alertChannels,
});

new ApiCheck('square-webhook-verifies', {
  name: 'Square webhook rejects unsigned requests',
  request: {
    method: 'POST',
    url: `${base}/api/webhooks/square`,
    body: '{"event_id":"synthetic-unsigned-probe"}',
    headers: [{ key: 'Content-Type', value: 'application/json' }],
    // 401 = verifying and rejecting (healthy). 501 = not configured yet.
    // 200 would mean an unsigned event was accepted: alarm.
    assertions: [AssertionBuilder.statusCode().equals(401)],
  },
  alertChannels,
});
