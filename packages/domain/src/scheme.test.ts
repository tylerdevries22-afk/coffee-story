import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isOwnAppScheme, isOwnAppUrl, schemeOf } from './scheme';

describe('schemeOf', () => {
  it('reads the scheme of an absolute URL, lower-cased', () => {
    assert.equal(schemeOf('coffeestory://book'), 'coffeestory:');
    assert.equal(schemeOf('COFFEE-Operator://book'), 'coffee-operator:');
    assert.equal(schemeOf('https://example.com/book'), 'https:');
  });

  it('returns null for anything that is not <scheme>://', () => {
    assert.equal(schemeOf('/client/book'), null);
    assert.equal(schemeOf('book'), null);
    assert.equal(schemeOf('mailto:someone@example.com'), null); // no authority
    assert.equal(schemeOf('://book'), null);
    assert.equal(schemeOf('9lives://book'), null); // a scheme starts with a letter
  });
});

describe('isOwnAppScheme', () => {
  it('accepts a private scheme, whatever the tenant or app registered', () => {
    for (const scheme of ['coffeestory:', 'coffee-operator:', 'yourbrand:', 'a+b.c-d:']) {
      assert.equal(isOwnAppScheme(scheme), true, scheme);
    }
  });

  it('refuses every scheme anyone else can serve or script', () => {
    for (const scheme of ['http:', 'https:', 'file:', 'data:', 'blob:', 'javascript:',
      'about:', 'content:', 'intent:', 'mailto:', 'tel:', 'sms:', 'ws:', 'wss:', 'ftp:']) {
      assert.equal(isOwnAppScheme(scheme), false, scheme);
    }
  });

  it('refuses exp:, which every project on the machine shares', () => {
    // Expo Go is not ours; callers that accept an exp:// link check its host.
    assert.equal(isOwnAppScheme('exp:'), false);
  });

  it('refuses malformed protocol values', () => {
    for (const value of ['', 'coffeestory', ':', '9lives:', 'coffee story:', 'HTTPS:']) {
      assert.equal(isOwnAppScheme(value), false, JSON.stringify(value));
    }
  });
});

describe('isOwnAppUrl', () => {
  it('is true only for a private scheme with an authority', () => {
    assert.equal(isOwnAppUrl('coffee-operator://orders'), true);
    assert.equal(isOwnAppUrl('coffeestory://book'), true);
    assert.equal(isOwnAppUrl('https://coffeestory.example/book'), false);
    assert.equal(isOwnAppUrl('exp://127.0.0.1:8081/--/book'), false);
    assert.equal(isOwnAppUrl('/client/book'), false);
  });
});
