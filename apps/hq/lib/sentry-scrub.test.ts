import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isTokenExchangeUrl, redactUrl, scrubBreadcrumb, scrubEvent } from './sentry-scrub';

const META_EXCHANGE = 'https://graph.facebook.com/v25.0/oauth/access_token'
  + '?grant_type=authorization_code&code=AQD-secret-code&client_id=meta-app'
  + '&client_secret=meta-app-secret&redirect_uri=https%3A%2F%2Fhq.example.com%2Fcb';

describe('OAuth telemetry scrubbing', () => {
  it('recognizes a token exchange by path or by sensitive parameter', () => {
    assert.equal(isTokenExchangeUrl(META_EXCHANGE), true);
    assert.equal(isTokenExchangeUrl('https://open.tiktokapis.com/v2/oauth/token/'), true);
    assert.equal(isTokenExchangeUrl('https://example.com/x?client_secret=s'), true);
    assert.equal(isTokenExchangeUrl('https://api.stripe.com/v1/account'), false);
    assert.equal(isTokenExchangeUrl('not a url'), false);
  });

  it('removes the client secret and the authorization code from a URL', () => {
    const redacted = redactUrl(META_EXCHANGE);
    assert.ok(!redacted.includes('meta-app-secret'), 'the client secret must not survive');
    assert.ok(!redacted.includes('AQD-secret-code'), 'the authorization code must not survive');
    assert.ok(redacted.includes('client_secret=REDACTED'));
    assert.ok(redacted.startsWith('https://graph.facebook.com/v25.0/oauth/access_token?'));
  });

  it('leaves an unrelated URL untouched', () => {
    const plain = 'https://api.stripe.com/v1/account?expand=settings';
    assert.equal(redactUrl(plain), plain);
    assert.equal(redactUrl('not a url'), 'not a url');
  });

  it('scrubs the breadcrumb shape Sentry records for an outgoing fetch', () => {
    const breadcrumb = scrubBreadcrumb({
      data: { url: META_EXCHANGE, 'http.query': '?client_secret=meta-app-secret' },
    });
    assert.equal(breadcrumb.data['http.query'], 'REDACTED');
    assert.ok(!String(breadcrumb.data.url).includes('meta-app-secret'));
  });

  it('scrubs the span attributes the undici instrumentation attaches', () => {
    const event = scrubEvent({
      request: { url: META_EXCHANGE },
      breadcrumbs: [{ data: { 'http.query': '?code=AQD-secret-code' } }],
      spans: [{ data: { 'url.full': META_EXCHANGE, 'url.query': '?client_secret=meta-app-secret' } }],
    });
    const serialized = JSON.stringify(event);
    assert.ok(!serialized.includes('meta-app-secret'), 'no secret anywhere in the event');
    assert.ok(!serialized.includes('AQD-secret-code'), 'no authorization code anywhere in the event');
  });

  it('scrubs the trace context, where the callback route\'s own code lands', () => {
    // The root span's attributes serialize to contexts.trace.data, so a callback
    // request carries the single-use authorization code there.
    const event = scrubEvent({
      contexts: {
        trace: {
          data: {
            'url.full': 'https://hq.example.com/api/connectors/meta-business-suite/callback?code=AQD-single-use&state=s',
            'http.url': 'https://hq.example.com/api/connectors/meta-business-suite/callback?code=AQD-single-use',
            'http.target': '/api/connectors/meta-business-suite/callback?code=AQD-single-use&state=s',
          },
        },
      },
    });
    const serialized = JSON.stringify(event);
    assert.ok(!serialized.includes('AQD-single-use'), 'the code must not survive anywhere');
    assert.ok(serialized.includes('code=REDACTED'));
  });

  it('redacts http.target, which is a path and query rather than a URL', () => {
    // `state` is a signed, public value, so only the code is redacted.
    assert.equal(
      redactUrl('/api/connectors/tiktok/callback?code=abc&state=s'),
      '/api/connectors/tiktok/callback?code=REDACTED&state=s',
    );
    assert.equal(redactUrl('/integrations?tab=connected'), '/integrations?tab=connected');
  });

  it('redacts a query that carries a code even with no URL beside it', () => {
    const breadcrumb = scrubBreadcrumb({ data: { 'http.query': '?code=AQD-secret-code' } });
    assert.equal(breadcrumb.data['http.query'], 'REDACTED');
  });

  it('keeps query telemetry for requests that are not token exchanges', () => {
    // Blanking every *query key would strip query strings from every unrelated
    // outgoing request in the deployment.
    const breadcrumb = scrubBreadcrumb({
      data: { url: 'https://api.stripe.com/v1/charges?limit=10', 'http.query': '?limit=10' },
    });
    assert.equal(breadcrumb.data['http.query'], '?limit=10', 'an unrelated query survives');
    assert.equal(breadcrumb.data.url, 'https://api.stripe.com/v1/charges?limit=10');
  });

  it('tolerates an event with none of the fields it scrubs', () => {
    assert.deepEqual(scrubEvent({ message: 'hello' }), { message: 'hello' });
    assert.deepEqual(scrubBreadcrumb({ category: 'ui' }), { category: 'ui' });
  });
});
