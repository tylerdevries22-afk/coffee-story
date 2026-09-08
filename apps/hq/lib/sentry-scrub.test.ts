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

  it('tolerates an event with none of the fields it scrubs', () => {
    assert.deepEqual(scrubEvent({ message: 'hello' }), { message: 'hello' });
    assert.deepEqual(scrubBreadcrumb({ category: 'ui' }), { category: 'ui' });
  });
});
