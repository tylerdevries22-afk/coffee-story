import assert from 'node:assert/strict';
import test from 'node:test';

import { CrawlBudget, DEFAULT_CRAWL_LIMITS } from './budget';
import { thrown } from './fakes.test-support';

test('requests are counted, and the one past the limit is refused', () => {
  const budget = new CrawlBudget({ maxRequests: 2, maxBytes: 100, deadlineMs: 1_000 }, () => 0);
  budget.takeRequest();
  budget.takeRequest();
  assert.equal(thrown(() => budget.takeRequest()).code, 'budget_exhausted');
  assert.equal(budget.usage().requests, 2);
});

test('bytes are counted, and the chunk that would overdraw is refused', () => {
  const budget = new CrawlBudget({ maxRequests: 2, maxBytes: 100, deadlineMs: 1_000 }, () => 0);
  budget.takeBytes(60);
  budget.takeBytes(40);
  assert.equal(budget.usage().bytes, 100);
  assert.equal(thrown(() => budget.takeBytes(1)).code, 'budget_exhausted');
});

test('the deadline runs on the injected clock and never goes negative', () => {
  let now = 5_000;
  const budget = new CrawlBudget({ maxRequests: 5, maxBytes: 100, deadlineMs: 1_000 }, () => now);
  assert.equal(budget.remainingMs(), 1_000);
  now = 5_400;
  assert.equal(budget.remainingMs(), 600);
  assert.equal(budget.usage().elapsedMs, 400);
  now = 7_000;
  assert.equal(budget.remainingMs(), 0);
  assert.equal(thrown(() => budget.takeRequest()).code, 'budget_exhausted');
});

test('the default allowance covers one full crawl with room for redirects and retries', () => {
  // robots.txt, 8 pages, 3 stylesheets, a logo and 12 images.
  assert.ok(DEFAULT_CRAWL_LIMITS.maxRequests >= 1 + 8 + 3 + 1 + 12);
  assert.ok(DEFAULT_CRAWL_LIMITS.maxBytes >= 8 * 1_048_576);
  assert.ok(DEFAULT_CRAWL_LIMITS.deadlineMs <= 120_000);
  assert.deepEqual(new CrawlBudget().limits, DEFAULT_CRAWL_LIMITS);
});
