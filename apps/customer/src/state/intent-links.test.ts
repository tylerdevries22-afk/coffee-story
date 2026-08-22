import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { destinationForIntentUrl, giftTokenFromUrl } from './intent-links';

describe('destinationForIntentUrl', () => {
  it('maps each Siri intent host to its destination', () => {
    assert.equal(destinationForIntentUrl('coffeestory://book'), 'book');
    assert.equal(destinationForIntentUrl('coffeestory://visits'), 'visits');
    assert.equal(destinationForIntentUrl('coffeestory://rewards'), 'rewards');
    assert.equal(destinationForIntentUrl('coffeestory://gift'), 'gift');
  });

  it('ignores URLs from other schemes and hosts', () => {
    assert.equal(destinationForIntentUrl('https://coffeestory.example/book'), null);
    assert.equal(destinationForIntentUrl('coffeestory://unknown'), null);
    assert.equal(destinationForIntentUrl('coffeestory://'), null);
    assert.equal(destinationForIntentUrl(null), null);
    assert.equal(destinationForIntentUrl(undefined), null);
    assert.equal(destinationForIntentUrl(''), null);
  });

  it('leaves gift claim links to the gift-claim flow', () => {
    const claimUrl = `coffeestory://gift?token=${'a'.repeat(32)}`;
    assert.equal(destinationForIntentUrl(claimUrl), null);
  });

  it('tolerates trailing slashes and casing', () => {
    assert.equal(destinationForIntentUrl('coffeestory://Book/'), 'book');
    assert.equal(destinationForIntentUrl('coffeestory://VISITS'), 'visits');
  });
});

describe('giftTokenFromUrl', () => {
  const token = 'a'.repeat(32);

  it('extracts the token from app and web gift-claim links', () => {
    assert.equal(giftTokenFromUrl(`coffeestory://gift?token=${token}`), token);
    assert.equal(giftTokenFromUrl(`https://coffeestory.example/gift?token=${token}`), token);
    // The fragment form is what giftClaimUrl() actually emails: a fragment is
    // never sent to the server, keeping the claim token out of access logs and
    // Referer headers. Rejecting it meant no real claim link could ever open.
    assert.equal(giftTokenFromUrl(`https://coffeestory.example/gift#token=${token}`), token);
    assert.equal(giftTokenFromUrl(`coffeestory://gift#token=${token}`), token);
    // Percent-encoded tokens decode before the length check.
    assert.equal(giftTokenFromUrl(`https://coffeestory.example/gift#token=${encodeURIComponent(token)}`), token);
  });

  it('never hijacks unrelated links that merely carry a token param', () => {
    assert.equal(giftTokenFromUrl(`coffeestory://rewards?token=${token}`), null);
    assert.equal(giftTokenFromUrl(`coffeestory://book?token=${token}`), null);
    assert.equal(giftTokenFromUrl(`https://coffeestory.example/auth/callback?token=${token}`), null);
    assert.equal(giftTokenFromUrl(`https://coffeestory.example/gifts?token=${token}`), null);
  });

  it('rejects missing, short, or malformed tokens', () => {
    assert.equal(giftTokenFromUrl('coffeestory://gift'), null);
    assert.equal(giftTokenFromUrl('coffeestory://gift?token=short'), null);
    assert.equal(giftTokenFromUrl('coffeestory://gift?token='), null);
    assert.equal(giftTokenFromUrl('coffeestory://gift#token=short'), null);
    assert.equal(giftTokenFromUrl(null), null);
    assert.equal(giftTokenFromUrl(undefined), null);
    assert.equal(giftTokenFromUrl('not-a-url'), null);
  });
});
