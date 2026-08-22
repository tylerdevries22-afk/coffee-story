import assert from 'node:assert/strict';
import { test } from 'node:test';

import { NATIVE_ADMIN_PAGES } from './content';

test('native admin content covers every secondary admin destination', () => {
  assert.deepEqual(Object.keys(NATIVE_ADMIN_PAGES), [
    '/admin/reviews', '/admin/reports', '/admin/talent-acquisition', '/admin/staff',
    '/admin/marketing', '/admin/analytics', '/admin/ads', '/admin/settings',
  ]);
});

test('each native page has complete dashboard content', () => {
  for (const page of Object.values(NATIVE_ADMIN_PAGES)) {
    assert.ok(page.eyebrow && page.title && page.summary && page.action);
    assert.ok(page.metrics.length > 0);
    assert.ok(page.rows.length > 0);
  }
});

