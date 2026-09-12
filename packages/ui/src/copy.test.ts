import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { UNIVERSAL_COPY, formatCopy, resolveCopy } from './copy';
import { GENERIC_COPY, INDUSTRY_COPY } from './copy-industry';

const COFFEE = INDUSTRY_COPY['coffee-shop'];
const CONSTRUCTION = INDUSTRY_COPY.construction;

describe('resolveCopy', () => {
  it('overlays the tenant dictionary on the defaults', () => {
    const copy = resolveCopy({ appName: 'Coffee Story', pointsName: 'Beans' }, 'coffee-shop');
    assert.equal(copy.appName, 'Coffee Story');
    assert.equal(copy.pointsName, 'Beans');
    assert.equal(copy.addToBag, COFFEE?.addToBag);
  });

  it('ignores non-string entries', () => {
    const copy = resolveCopy({ appName: 42, orderCta: null }, 'coffee-shop');
    assert.equal(copy.appName, COFFEE?.appName);
    assert.equal(copy.orderCta, COFFEE?.orderCta);
  });

  it('resolves universal, then industry, then tenant', () => {
    const copy = resolveCopy({ orderCta: 'Book a walkthrough' }, 'construction');
    assert.equal(copy.checkoutTitle, UNIVERSAL_COPY.checkoutTitle);
    assert.equal(copy.addToBag, CONSTRUCTION?.addToBag);
    assert.equal(copy.orderCta, 'Book a walkthrough');
  });

  /**
   * The silent inheritance this layer exists to stop: a tenant that overrides
   * a handful of keys must not pick up another vertical's words for the rest.
   */
  it('gives a vertical its own wording for keys the tenant left alone', () => {
    const builder = resolveCopy({ appName: 'Stillpoint Builders' }, 'construction');
    assert.equal(builder.addToBag, 'Add to request');
    assert.notEqual(builder.addToBag, COFFEE?.addToBag);
    assert.notEqual(builder.handoffPromise, COFFEE?.handoffPromise);
  });

  it('falls back to neutral wording rather than to a vertical', () => {
    // A brand row written before the field existed names no industry at all,
    // and the database spells its own neutral industry `general`.
    for (const key of [undefined, 'general', 'a-vertical-nobody-wrote']) {
      assert.equal(resolveCopy(null, key).addToBag, GENERIC_COPY.addToBag);
    }
    assert.notEqual(GENERIC_COPY.addToBag, COFFEE?.addToBag);
  });
});

describe('formatCopy', () => {
  it('fills placeholders', () => {
    const copy = resolveCopy({ earnBanner: 'Earn {points} {pointsName} for this order' });
    assert.equal(formatCopy(copy, 'earnBanner', { points: 96, pointsName: 'Beans' }), 'Earn 96 Beans for this order');
  });

  it('leaves unknown placeholders visible rather than blank', () => {
    // A silently emptied placeholder reads as broken copy with no clue why.
    assert.equal(formatCopy(resolveCopy(null), 'earnBanner', { points: 5 }), 'Earn 5 {pointsName} for this order');
  });

  it('falls back to the key for a missing entry', () => {
    assert.equal(formatCopy(resolveCopy(null), 'not.a.key'), 'not.a.key');
  });
});
