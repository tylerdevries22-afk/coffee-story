import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { pathMatchesHref } from './navigation-path';

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
