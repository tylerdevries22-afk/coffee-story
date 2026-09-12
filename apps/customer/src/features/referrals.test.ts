import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { REFERRAL_SHARE_EXPLAINER, referralCodeFor, referralIncomingMessage } from './referrals';

describe('referralCodeFor', () => {
  it('is stable for the same name', () => {
    assert.equal(referralCodeFor('Jordan Álvarez', 'CS'), referralCodeFor('Jordan Álvarez', 'CS'));
  });

  it('differs between people', () => {
    assert.notEqual(referralCodeFor('Jordan Álvarez', 'CS'), referralCodeFor('Sam Reyes', 'CS'));
  });

  it('keeps the prefix and survives an empty name', () => {
    const code = referralCodeFor('', 'CS');
    assert.match(code, /^CS-FRIEND-[0-9A-F]{4}$/);
  });

  it('strips accents and symbols from the name part', () => {
    assert.match(referralCodeFor('Ñandú O\'Brien', 'CS'), /^CS-[A-Z0-9]{1,8}-[0-9A-F]{4}$/);
  });
});

describe('referralIncomingMessage', () => {
  it('does not promise automatic application', () => {
    const message = referralIncomingMessage('CS-JORDAN-7F3A');
    assert.doesNotMatch(message, /nothing else to do/i);
    assert.doesNotMatch(message, /automatically/i);
  });

  it('names the manual path and includes the code', () => {
    const message = referralIncomingMessage('CS-JORDAN-7F3A');
    assert.match(message, /CS-JORDAN-7F3A/);
    assert.match(message, /team/i);
  });
});

describe('REFERRAL_SHARE_EXPLAINER', () => {
  it('does not promise a reward is loaded automatically', () => {
    assert.doesNotMatch(REFERRAL_SHARE_EXPLAINER, /loaded onto your rewards/i);
    assert.doesNotMatch(REFERRAL_SHARE_EXPLAINER, /automatically/i);
  });
});
