import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DEFAULT_TOKENS, resolveTokens } from './tokens';

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
    resolveTokens({
      radius: { sm: 2 }, spacing: { xs: 1 }, motion: { fast: 90 },
      elevation: { card: 0.2 }, type: { md: 18 },
    });
    assert.equal(JSON.stringify(DEFAULT_TOKENS), before);
  });

  /**
   * The idempotence check. A key added to BrandTokens but forgotten in the
   * validator loop silently reverts to its default on every hydration, which
   * looks like "the tenant never set it" rather than like a bug.
   */
  it('round-trips its own defaults, so no token group is silently unvalidated', () => {
    assert.deepEqual(resolveTokens(DEFAULT_TOKENS), DEFAULT_TOKENS);
  });

  it('accepts the new motion and type rungs a kiosk needs', () => {
    const tokens = resolveTokens({ motion: { stagger: 60, celebrate: 800 }, type: { lg: 22, ticket: 200 } });
    assert.equal(tokens.motion.stagger, 60);
    assert.equal(tokens.motion.celebrate, 800);
    assert.equal(tokens.type.lg, 22);
    assert.equal(tokens.type.ticket, 200);
    assert.equal(tokens.motion.fast, DEFAULT_TOKENS.motion.fast);
  });

  it('holds elevation to a fraction, because it is an opacity and not a length', () => {
    // The shared 0..1000 ceiling would have accepted 500 here and painted an
    // opaque slab over the card the shadow was meant to lift.
    const tokens = resolveTokens({ elevation: { card: 500, raised: 0.3 } });
    assert.equal(tokens.elevation.card, DEFAULT_TOKENS.elevation.card);
    assert.equal(tokens.elevation.raised, 0.3);
  });

  it('ignores a group key it does not already know', () => {
    const tokens = resolveTokens({ motion: { warp: 10 }, type: { gigantic: 400 } });
    assert.equal('warp' in tokens.motion, false);
    assert.equal('gigantic' in tokens.type, false);
  });
});
