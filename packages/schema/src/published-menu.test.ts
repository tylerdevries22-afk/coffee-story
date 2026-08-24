import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { PublishedMenuConfigurationError, requireSinglePublishedMenuId } from './published-menu';

describe('requireSinglePublishedMenuId', () => {
  it('returns the only menu', () => {
    assert.equal(requireSinglePublishedMenuId([{ id: 'menu-a' }]), 'menu-a');
  });

  it('fails closed when no menu or multiple menus are published', () => {
    for (const rows of [[], [{ id: 'menu-a' }, { id: 'menu-b' }]]) {
      assert.throws(() => requireSinglePublishedMenuId(rows), PublishedMenuConfigurationError);
    }
  });
});
