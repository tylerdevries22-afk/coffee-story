import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { initialsFor, resolveImage } from './resolve-image';

const BUNDLED = { latte: 42 };
const WEB_BUNDLED = {
  latte: { uri: '/assets/latte.webp', width: 900, height: 900 },
};

describe('resolveImage', () => {
  it('prefers tenant artwork for a known slug, even when the live row carries a URL', () => {
    assert.deepEqual(
      resolveImage({ imageUrl: 'https://cdn.example/latte.webp', imageSlug: 'latte' }, BUNDLED),
      { kind: 'bundled', source: 42 },
    );
  });

  it('uses a secure remote photograph for an item added after the binary shipped', () => {
    assert.deepEqual(
      resolveImage({ imageUrl: 'https://cdn.example/new-drink.webp', imageSlug: 'new-drink' }, BUNDLED),
      { kind: 'remote', uri: 'https://cdn.example/new-drink.webp' },
    );
  });

  it('refuses a plaintext or malformed url rather than fetching it', () => {
    // A kiosk must not be talked into an http fetch by a config edit.
    for (const bad of ['http://cdn.example/x.webp', 'not a url', '', null, undefined]) {
      const resolved = resolveImage({ imageUrl: bad, imageSlug: 'latte' }, BUNDLED);
      assert.equal(resolved.kind, 'bundled', JSON.stringify(bad));
    }
  });

  it('falls back to the bundled set when there is no usable url', () => {
    assert.deepEqual(resolveImage({ imageSlug: 'latte' }, BUNDLED), { kind: 'bundled', source: 42 });
  });

  it('recognises Expo web asset objects instead of replacing every photograph with a monogram', () => {
    assert.deepEqual(resolveImage({ imageSlug: 'latte', monogram: 'CS' }, WEB_BUNDLED), {
      kind: 'bundled',
      source: WEB_BUNDLED.latte,
    });
  });

  it('falls back to the monogram after a live-only remote photograph exhausts its retry', () => {
    const request = {
      imageUrl: 'https://cdn.example/new-drink.webp',
      imageSlug: 'new-drink',
      monogram: 'CS',
    };
    assert.deepEqual(
      resolveImage(request, BUNDLED, request.imageUrl),
      { kind: 'monogram', initials: 'CS' },
    );
  });

  it('always resolves to something, because a circle is a target about to be pressed', () => {
    const resolved = resolveImage({ imageSlug: 'missing', monogram: 'CS' }, BUNDLED);
    assert.deepEqual(resolved, { kind: 'monogram', initials: 'CS' });
    assert.equal(resolveImage({}, {}).kind, 'monogram');
  });
});

describe('initialsFor', () => {
  it('uses the brand mark, so an unphotographed tile still reads as this shop', () => {
    assert.equal(initialsFor({ monogram: 'cs', label: 'Boba' }), 'CS');
  });

  it('falls back to the label only when the brand has no monogram', () => {
    assert.equal(initialsFor({ label: 'Boba' }), 'B');
    assert.equal(initialsFor({ monogram: '   ', label: 'Boba' }), 'B');
  });

  it('returns nothing rather than throwing when it has nothing to work with', () => {
    assert.equal(initialsFor({}), '');
  });
});
