import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { operatorPairingLink, parseOperatorPairingLink } from './pairing-link';

describe('operator pairing links', () => {
  it('round-trips a valid, explicitly scoped QR intent', () => {
    const link = operatorPairingLink({ code: 'BC234567', tenantSlug: 'coffee-story' });
    assert.deepEqual(parseOperatorPairingLink(link), { code: 'BC234567', tenantSlug: 'coffee-story' });
  });

  it('refuses links that are not the installed Operator scheme', () => {
    assert.equal(parseOperatorPairingLink('https://example.test/pair?code=BC234567&tenant=coffee-story'), null);
    assert.equal(parseOperatorPairingLink('platform-operator://pair?code=bc234567&tenant=coffee-story'), null);
    assert.equal(parseOperatorPairingLink('platform-operator://pair?code=BC234567&tenant=other_tenant'), null);
  });
});
