import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DEFAULT_TOKENS, resolveTokens } from './tokens.ts';

describe('resolveTokens', () => {
  it('returns the defaults for a missing config', () => {
    assert.deepEqual(resolveTokens(undefined), DEFAULT_TOKENS);
    assert.deepEqual(resolveTokens(null), DEFAULT_TOKENS);
    assert.deepEqual(resolveTokens('nonsense'), DEFAULT_TOKENS);
  });

  it('applies a tenant palette over the defaults', () => {
    const tokens = resolveTokens({ primary: '#2E211A', accent: '#B08D57', fontDisplay: 'Fraunces' });
    assert.equal(tokens.primary, '#2E211A');
    assert.equal(tokens.accent, '#B08D57');
    assert.equal(tokens.fontDisplay, 'Fraunces');
    assert.equal(tokens.surface, DEFAULT_TOKENS.surface);
  });

  it('drops a malformed color without losing the rest', () => {
    // One typo must not unbrand the whole app.
    const tokens = resolveTokens({ primary: 'reddish', accent: '#B08D57' });
    assert.equal(tokens.primary, DEFAULT_TOKENS.primary);
    assert.equal(tokens.accent, '#B08D57');
  });

  it('rejects out-of-range scale values', () => {
    const tokens = resolveTokens({ radius: { sm: -4, md: 4000, lg: 20 }, spacing: { md: 14 } });
    assert.equal(tokens.radius.sm, DEFAULT_TOKENS.radius.sm);
    assert.equal(tokens.radius.md, DEFAULT_TOKENS.radius.md);
    assert.equal(tokens.radius.lg, 20);
    assert.equal(tokens.spacing.md, 14);
  });

  it('never mutates the defaults', () => {
    const before = JSON.stringify(DEFAULT_TOKENS);
    resolveTokens({ radius: { sm: 2 }, spacing: { xs: 1 }, motion: { fast: 90 } });
    assert.equal(JSON.stringify(DEFAULT_TOKENS), before);
  });
});
