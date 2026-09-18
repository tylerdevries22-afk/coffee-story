import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { demoPack, logoSourceOf, menuMediaOf, runtimeSlug } from './pack';

const isValidSlug = (value: string) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(value);

afterEach(() => {
  globalThis.__PLATFORM_DEMO_PACK__ = undefined;
});

describe('demoPack', () => {
  it('reads whatever the boot module stashed on the global', () => {
    const pack = { brand: { identity: { name: 'Harbor Roast' } } };
    globalThis.__PLATFORM_DEMO_PACK__ = pack;
    assert.equal(demoPack(), pack);
  });

  it('is an empty object, never a throw, when the global was never set', () => {
    assert.deepEqual(demoPack(), {});
  });
});

describe('menuMediaOf', () => {
  it('wraps each proxy path as a runtime image source', () => {
    const media = menuMediaOf({ media: { items: { latte: '/d/media/latte.webp' } } });
    assert.deepEqual(media, { latte: { uri: '/d/media/latte.webp' } });
  });

  it('is empty, not a throw, for a pack with no media at all', () => {
    assert.deepEqual(menuMediaOf({}), {});
  });
});

describe('logoSourceOf', () => {
  it('prefers the pack\'s own logo', () => {
    assert.deepEqual(logoSourceOf({ media: { logo: '/d/media/logo.webp' } }, 99), { uri: '/d/media/logo.webp' });
  });

  it('falls back when the pack has no logo', () => {
    assert.equal(logoSourceOf({ media: { logo: null } }, 99), 99);
    assert.equal(logoSourceOf({}, 99), 99);
  });
});

describe('runtimeSlug', () => {
  it('names the slot after the pack\'s own business', () => {
    assert.equal(runtimeSlug({ identity: { slug: 'harbor-roast' } }, isValidSlug), 'harbor-roast');
  });

  it('falls back to the reserved slug for a malformed, missing, or hostile slug', () => {
    for (const brand of [
      {},
      null,
      { identity: {} },
      { identity: { slug: 'Not_Kebab' } },
      { identity: { slug: '__proto__' } },
      { identity: { slug: 123 } },
    ]) {
      assert.equal(runtimeSlug(brand, isValidSlug), 'demo');
    }
  });
});
