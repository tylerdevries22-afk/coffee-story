import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import coffeeStory from '../../../tenants/coffee-story/brand.json';
import { mixHex, resolveAppTokens } from './app-tokens';

describe('mixHex', () => {
  it('mixes endpoints and clamps the weight', () => {
    assert.equal(mixHex('#000000', '#FFFFFF', 0.5), '#808080');
    assert.equal(mixHex('#112233', '#FFFFFF', -1), '#112233');
    assert.equal(mixHex('#112233', '#FFFFFF', 2), '#FFFFFF');
  });

  it('rejects malformed inputs instead of deriving a corrupt palette', () => {
    assert.throws(() => mixHex('black', '#FFFFFF', 0.5), RangeError);
    assert.throws(() => mixHex('#000000', '#FFFFFF', Number.NaN), RangeError);
  });
});

describe('resolveAppTokens', () => {
  it('derives every app token from a partial tenant config', () => {
    const tokens = resolveAppTokens({ primary: '#123456', surface: '#FAFAFA' });
    assert.equal(tokens.colors.brand900, '#123456');
    assert.match(tokens.colors.brand300, /^#[0-9A-F]{6}$/);
    assert.equal(tokens.scrim.color, tokens.colors.brand900);
    assert.ok(tokens.radius.xl > tokens.radius.lg);
  });

  it('honours valid ramp overrides field by field', () => {
    const tokens = resolveAppTokens({
      primary: '#123456',
      ramp: { brand500: '#ABCDEF', ink900: 'not-a-colour' },
    });
    assert.equal(tokens.colors.brand500, '#ABCDEF');
    assert.notEqual(tokens.colors.ink900, 'not-a-colour');
  });

  it('preserves the shipped Coffee Story palette exactly', () => {
    const tokens = resolveAppTokens(coffeeStory.tokens);
    assert.equal(tokens.colors.brand50, '#FAF5EF');
    assert.equal(tokens.colors.brand900, '#241710');
    assert.equal(tokens.colors.gold400, '#D9A45B');
    assert.equal(tokens.colors.ink600, '#57483B');
    assert.equal(tokens.colors.success, '#3B664B');
    assert.equal(tokens.fonts.sans, 'Inter_400Regular');
    assert.equal(tokens.fonts.display, 'Fraunces_700Bold');
  });

  it('falls back safely for an unsupported font family', () => {
    const tokens = resolveAppTokens({ fontBody: 'Missing Sans', fontDisplay: 'Missing Serif' });
    assert.deepEqual(tokens.fonts, {
      sans: 'System', sansMedium: 'System', sansBold: 'System', display: 'System',
    });
  });
});
