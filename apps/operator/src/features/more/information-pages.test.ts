import assert from 'node:assert/strict';
import { test } from 'node:test';

import { INFORMATION_PAGES } from './information-pages';

test('information pages preserve every More destination', () => {
  assert.deepEqual(Object.keys(INFORMATION_PAGES), ['location', 'resources', 'faq', 'care-policy', 'privacy']);
});

test('every information page has display copy, rows, and a web destination', () => {
  for (const page of Object.values(INFORMATION_PAGES)) {
    assert.ok(page.eyebrow && page.title && page.summary);
    assert.ok(page.rows.length > 0);
    assert.match(page.webPath ?? '', /^\//);
    assert.ok(page.action);
  }
});

test('the FAQ keeps the stored-value rewards caveat', () => {
  assert.match(
    INFORMATION_PAGES.faq.rows.find((row) => row.title.includes('rewards'))?.detail ?? '',
    /stored value/,
  );
});
