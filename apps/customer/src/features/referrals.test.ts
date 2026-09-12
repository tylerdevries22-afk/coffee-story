import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { referralCodeFor } from './referrals';

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
