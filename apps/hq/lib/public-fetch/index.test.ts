import assert from 'node:assert/strict';
import test from 'node:test';

import * as publicFetch from './index';
import { page, scriptedTransport } from './fakes.test-support';

test('the barrel is the whole public surface a crawler needs', async () => {
  for (const name of [
    'fetchPublic', 'CrawlBudget', 'PublicFetchError', 'isPublicFetchError', 'isPublicIpAddress', 'parsePublicUrl',
    'createHttpsTransport', 'sniffImageFormat', 'KIND_POLICIES', 'DEFAULT_CRAWL_LIMITS', 'DEFAULT_TIMEOUTS',
    'MAX_REDIRECTS', 'DEMO_BUILDER_PRODUCT_TOKEN', 'PUBLIC_FETCH_USER_AGENT',
  ]) {
    assert.ok(name in publicFetch, name);
  }
  const transport = scriptedTransport(() => page('ok'));
  const result = await publicFetch.fetchPublic('https://shop.example.com/', 'html', {
    budget: new publicFetch.CrawlBudget(), transport,
  });
  assert.equal(result.body.toString('utf8'), 'ok');
});
