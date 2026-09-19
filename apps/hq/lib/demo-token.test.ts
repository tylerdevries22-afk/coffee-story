import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { demoBuilder } from './demo-builder';
import { demoTokenHash, isDemoToken, newDemoToken } from './demo-token';

describe('demo link tokens', () => {
  it('are 256 random bits, url-safe, and never repeat', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => newDemoToken()));
    assert.equal(tokens.size, 200);
    for (const token of tokens) assert.ok(isDemoToken(token), token);
  });

  it('refuse anything that is not exactly that shape, before a database sees it', () => {
    const good = newDemoToken();
    for (const bad of [good.slice(1), `${good}A`, `${good.slice(1)}+`, `${good.slice(1)}/`, `${good.slice(1)}=`, '', 42, null]) {
      assert.equal(isDemoToken(bad), false, String(bad));
    }
  });

  // Only the hash is stored, so the hash must be the standard one: a known
  // vector pins it, and the database's `^[0-9a-f]{64}$` check must accept it.
  it('hash to lowercase SHA-256 hex', () => {
    assert.equal(demoTokenHash('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    assert.match(demoTokenHash(newDemoToken()), /^[0-9a-f]{64}$/);
  });
});

describe('the demo builder line', () => {
  it('is required: no name, no demos', () => {
    assert.equal(demoBuilder({}), null);
    assert.equal(demoBuilder({ DEMO_BUILDER_NAME: '   ' }), null);
  });

  it('refuses a name that could not be an honest company name', () => {
    for (const name of ['<b>Acme</b>', 'x'.repeat(81), 'LineBell']) {
      assert.equal(demoBuilder({ DEMO_BUILDER_NAME: name }), null, name);
    }
  });

  it('normalizes whitespace and keeps a safe contact link', () => {
    assert.deepEqual(demoBuilder({ DEMO_BUILDER_NAME: '  Example   Studio ', DEMO_BUILDER_CONTACT: 'hello@example.test' }),
      { name: 'Example Studio', contactHref: 'mailto:hello@example.test' });
    assert.equal(demoBuilder({ DEMO_BUILDER_NAME: 'Example', DEMO_BUILDER_CONTACT: 'https://example.test/talk' })?.contactHref,
      'https://example.test/talk');
  });

  it('drops a contact link that is not mailto or https', () => {
    for (const contact of ['http://example.test', 'javascript:alert(1)', 'https://user:pass@example.test', 'not a link']) {
      assert.equal(demoBuilder({ DEMO_BUILDER_NAME: 'Example', DEMO_BUILDER_CONTACT: contact })?.contactHref, null, contact);
    }
  });
});
