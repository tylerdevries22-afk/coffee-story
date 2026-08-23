import assert from 'node:assert/strict';
import { test } from 'node:test';

import { currentBusiness } from '@/data/business';

import { informationPages } from './information-pages';

test('information pages preserve every More destination', () => {
  assert.deepEqual(Object.keys(informationPages()), ['location', 'resources', 'faq', 'care-policy', 'privacy']);
});

test('every information page has display copy, rows, and a web destination', () => {
  for (const page of Object.values(informationPages())) {
    assert.ok(page.eyebrow && page.title && page.summary);
    assert.ok(page.rows.length > 0);
    assert.match(page.webPath ?? '', /^\//);
    assert.ok(page.action);
  }
});

test('the FAQ keeps the stored-value rewards caveat', () => {
  assert.match(
    informationPages().faq.rows.find((row) => row.title.includes('rewards'))?.detail ?? '',
    /stored value/,
  );
});

test('the location page names the tenant, not the one it was written for', () => {
  const business = currentBusiness();
  const location = informationPages().location;
  assert.ok(location.summary.includes(business.name));
  const where = location.rows.find((row) => row.title === 'Where we are')?.detail ?? '';
  assert.ok(where.includes(business.street), where);
  assert.ok(where.includes(business.phone), where);
});
