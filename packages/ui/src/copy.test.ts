import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DEFAULT_COPY, formatCopy, resolveCopy } from './copy';

describe('resolveCopy', () => {
  it('overlays the tenant dictionary on the defaults', () => {
    const copy = resolveCopy({ appName: 'Coffee Story', pointsName: 'Beans' });
    assert.equal(copy.appName, 'Coffee Story');
    assert.equal(copy.pointsName, 'Beans');
    assert.equal(copy.addToBag, DEFAULT_COPY.addToBag);
  });

  it('ignores non-string entries', () => {
    const copy = resolveCopy({ appName: 42, orderCta: null });
    assert.equal(copy.appName, DEFAULT_COPY.appName);
    assert.equal(copy.orderCta, DEFAULT_COPY.orderCta);
  });
});

describe('formatCopy', () => {
  it('fills placeholders', () => {
    const copy = resolveCopy({ earnBanner: 'Earn {points} {pointsName} for this order' });
    assert.equal(formatCopy(copy, 'earnBanner', { points: 96, pointsName: 'Beans' }), 'Earn 96 Beans for this order');
  });

  it('leaves unknown placeholders visible rather than blank', () => {
    // A silently emptied placeholder reads as broken copy with no clue why.
    assert.equal(formatCopy(DEFAULT_COPY, 'earnBanner', { points: 5 }), 'Earn 5 {pointsName} for this order');
  });

  it('falls back to the key for a missing entry', () => {
    assert.equal(formatCopy(DEFAULT_COPY, 'not.a.key'), 'not.a.key');
  });
});
