import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { FALLBACK_SECTION, pageTitleFor } from './console-shell-config';

describe('pageTitleFor', () => {
  it('uses the most specific label for known and nested utility routes', () => {
    assert.equal(pageTitleFor('/analytics/commerce', FALLBACK_SECTION), 'Commerce analytics');
    assert.equal(pageTitleFor('/apps/customer', FALLBACK_SECTION), 'Customer app');
    assert.equal(pageTitleFor('/wall/preview/union-station', FALLBACK_SECTION), 'Location display');
    assert.equal(pageTitleFor('/status/coffee-story', FALLBACK_SECTION), 'System status');
  });

  it('falls back to the active role-aware section', () => {
    assert.equal(pageTitleFor('/future-route', FALLBACK_SECTION), 'Dashboard');
  });
});
