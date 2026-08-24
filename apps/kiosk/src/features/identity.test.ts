import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { digitsOf, displayName, formatPhone, isCompletePhone, maskPhone } from './identity';

describe('formatPhone', () => {
  it('formats as it is typed, not on submit', () => {
    assert.equal(formatPhone('7'), '7');
    assert.equal(formatPhone('720'), '720');
    assert.equal(formatPhone('720609'), '(720) 609');
    assert.equal(formatPhone('7206092971'), '(720) 609-2971');
  });

  it('ignores anything a paste could bring in', () => {
    assert.equal(formatPhone('+1 (720) 609-2971'), '(172) 060-9297');
    assert.equal(digitsOf('abc'), '');
  });

  it('stops at ten digits rather than growing forever', () => {
    assert.equal(digitsOf('72060929719999'), '7206092971');
    assert.equal(isCompletePhone('7206092971'), true);
    assert.equal(isCompletePhone('720609297'), false);
  });
});

describe('maskPhone', () => {
  /**
   * `posture.unattended` is true for a lobby kiosk: the next guest in the queue
   * sees whatever the last one left on screen.
   */
  it('keeps only the last four, so the screen is not somebody else account', () => {
    assert.equal(maskPhone('7206092971'), '••• ••• 2971');
  });

  it('refuses to mask a number that is not whole, rather than half-masking one', () => {
    assert.equal(maskPhone('720609'), null);
    assert.equal(maskPhone(''), null);
  });
});

describe('displayName', () => {
  it('shows a first name only on a screen a whole room can see', () => {
    assert.equal(displayName('Sara Delgado'), 'Sara');
    assert.equal(displayName('  Ana  Maria  Lopez '), 'Ana');
  });

  it('returns nothing rather than throwing on an empty record', () => {
    assert.equal(displayName(''), '');
  });
});
