import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { demoMenuImagePaths } from './demo-menu-media';

describe('demoMenuImagePaths', () => {
  it('covers workspace-root and app-root customer image locations', () => {
    const rootPaths = demoMenuImagePaths('/workspace', 'espresso');
    const appPaths = demoMenuImagePaths('/workspace/apps/hq', 'espresso');

    assert.ok(rootPaths.includes('/workspace/apps/customer/assets/menu/coffee-story/espresso.webp'));
    assert.ok(appPaths.includes('/workspace/apps/customer/assets/menu/coffee-story/espresso.webp'));
  });

  it('rejects path traversal and malformed slugs', () => {
    assert.deepEqual(demoMenuImagePaths('/workspace', '../espresso'), []);
    assert.deepEqual(demoMenuImagePaths('/workspace', 'Espresso'), []);
  });
});
