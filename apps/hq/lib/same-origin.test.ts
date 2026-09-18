import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { sameOriginRequest } from './same-origin';

const URL_HERE = 'https://hq.example.test/api/places/autocomplete';

function post(headers: Record<string, string>): Request {
  return new Request(URL_HERE, { method: 'POST', headers });
}

describe('a request from the console itself', () => {
  it('is admitted with this origin, whether or not the browser sends Sec-Fetch-Site', () => {
    assert.equal(sameOriginRequest(post({ origin: 'https://hq.example.test', 'sec-fetch-site': 'same-origin' })), true);
    assert.equal(sameOriginRequest(post({ origin: 'https://hq.example.test' })), true);
  });

  it('is refused from any other origin, including a lookalike and a sibling subdomain', () => {
    for (const origin of ['https://attacker.example', 'https://hq.example.test.attacker.example',
      'http://hq.example.test', 'https://hq.example.test:8443', 'https://preview.example.test']) {
      assert.equal(sameOriginRequest(post({ origin })), false, origin);
    }
  });

  it('is refused when the browser says the page was another site, whatever Origin claims', () => {
    for (const site of ['same-site', 'cross-site', 'none']) {
      assert.equal(sameOriginRequest(post({ origin: 'https://hq.example.test', 'sec-fetch-site': site })), false, site);
    }
  });

  it('is refused with no Origin, or one that is not a URL', () => {
    assert.equal(sameOriginRequest(post({})), false);
    assert.equal(sameOriginRequest(post({ origin: 'null' })), false);
  });
});
