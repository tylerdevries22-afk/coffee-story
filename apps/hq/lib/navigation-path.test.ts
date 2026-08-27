import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { bestMatchingHref, pathMatchesHref } from './navigation-path';

describe('pathMatchesHref', () => {
  it('matches root only at the console root', () => {
    assert.equal(pathMatchesHref('/', '/'), true);
    assert.equal(pathMatchesHref('/locations', '/'), false);
  });

  it('matches a destination and its nested pages', () => {
    assert.equal(pathMatchesHref('/wall', '/wall'), true);
    assert.equal(pathMatchesHref('/wall/preview/store-1', '/wall'), true);
  });

  it('does not activate a sibling that merely shares a prefix', () => {
    assert.equal(pathMatchesHref('/customers-export', '/customers'), false);
  });
});

describe('bestMatchingHref', () => {
  it('selects the deepest destination for a nested pathname', () => {
    assert.equal(
      bestMatchingHref('/analytics/apps/session/1', ['/analytics', '/analytics/apps']),
      '/analytics/apps',
    );
  });

  it('returns undefined when no destination owns the pathname', () => {
    assert.equal(bestMatchingHref('/customers', ['/analytics', '/integrations']), undefined);
  });
});
