import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CATERING_UNAVAILABLE_MESSAGE, cateringEmailHref, cateringPhoneHref } from './catering-request';

describe('CATERING_UNAVAILABLE_MESSAGE', () => {
  it('does not claim the request was sent or received', () => {
    assert.doesNotMatch(CATERING_UNAVAILABLE_MESSAGE, /request received/i);
    assert.doesNotMatch(CATERING_UNAVAILABLE_MESSAGE, /will reply/i);
  });

  it('gives the guest a real next action', () => {
    assert.match(CATERING_UNAVAILABLE_MESSAGE, /call or email/i);
  });
});

describe('cateringPhoneHref', () => {
  it('strips formatting down to digits and a leading +', () => {
    assert.equal(cateringPhoneHref('(720) 609-2971'), 'tel:7206092971');
  });

  it('keeps a leading international +', () => {
    assert.equal(cateringPhoneHref('+1 (720) 609-2971'), 'tel:+17206092971');
  });
});

describe('cateringEmailHref', () => {
  it('builds a mailto link with an encoded subject', () => {
    assert.equal(
      cateringEmailHref('hello@coffeestoryco.com'),
      'mailto:hello@coffeestoryco.com?subject=Catering%20request',
    );
  });

  it('accepts a custom subject', () => {
    assert.equal(
      cateringEmailHref('hello@coffeestoryco.com', 'Wedding, 80 guests'),
      'mailto:hello@coffeestoryco.com?subject=Wedding%2C%2080%20guests',
    );
  });
});
