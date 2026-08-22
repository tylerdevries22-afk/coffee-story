/**
 * The ordering API surface and the Square webhook endpoint. The webhook
 * check asserts the endpoint *rejects* an unsigned request -- a 200 there
 * would mean signature verification is off, which is the outage that
 * matters.
 */
import { ApiCheck, AssertionBuilder } from 'checkly/constructs';

const base = '{{PLATFORM_BASE_URL}}';

new ApiCheck('hq-console-up', {
  name: 'HQ console responds',
  request: {
    method: 'GET',
    url: `${base}/`,
    followRedirects: true,
    assertions: [AssertionBuilder.statusCode().equals(200)],
  },
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
});
