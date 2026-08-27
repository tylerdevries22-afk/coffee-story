import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isWallLocationId, wallTargetFor } from './wall';

const mutableEnv = process.env as Record<string, string | undefined>;

describe('wallTargetFor', () => {
  it('uses the local five-surface wall outside production', () => {
    const previous = process.env.NODE_ENV;
    const previousWall = process.env.NEXT_PUBLIC_WALL_URL;
    const previousDisplay = process.env.NEXT_PUBLIC_DISPLAY_URL;
    mutableEnv.NODE_ENV = 'development';
    delete mutableEnv.NEXT_PUBLIC_WALL_URL;
    try {
      assert.deepEqual(wallTargetFor('loc-downtown'), {
        url: 'http://localhost:4170/wall',
        source: 'preview',
      });
    } finally {
      if (previous === undefined) delete mutableEnv.NODE_ENV;
      else mutableEnv.NODE_ENV = previous;
      if (previousWall === undefined) delete mutableEnv.NEXT_PUBLIC_WALL_URL;
      else mutableEnv.NEXT_PUBLIC_WALL_URL = previousWall;
      if (previousDisplay === undefined) delete mutableEnv.NEXT_PUBLIC_DISPLAY_URL;
      else mutableEnv.NEXT_PUBLIC_DISPLAY_URL = previousDisplay;
    }
  });

  it('resolves a production display board for a validated location', () => {
    const previous = process.env.NODE_ENV;
    const previousWall = process.env.NEXT_PUBLIC_WALL_URL;
    const previousDisplay = process.env.NEXT_PUBLIC_DISPLAY_URL;
    mutableEnv.NODE_ENV = 'production';
    delete mutableEnv.NEXT_PUBLIC_WALL_URL;
    delete mutableEnv.NEXT_PUBLIC_DISPLAY_URL;
    try {
      assert.deepEqual(wallTargetFor('dd9858ac-849b-4ea7-a649-ff5c478552c2'), {
        url: '/wall/preview/dd9858ac-849b-4ea7-a649-ff5c478552c2',
        source: 'hq',
      });
    } finally {
      if (previous === undefined) delete mutableEnv.NODE_ENV;
      else mutableEnv.NODE_ENV = previous;
      if (previousWall === undefined) delete mutableEnv.NEXT_PUBLIC_WALL_URL;
      else mutableEnv.NEXT_PUBLIC_WALL_URL = previousWall;
      if (previousDisplay === undefined) delete mutableEnv.NEXT_PUBLIC_DISPLAY_URL;
      else mutableEnv.NEXT_PUBLIC_DISPLAY_URL = previousDisplay;
    }
  });

  it('rejects unsafe location ids before building a frame URL', () => {
    assert.throws(() => wallTargetFor('../other-tenant'), /Invalid location id/);
    assert.equal(isWallLocationId('other tenant'), false);
    assert.equal(isWallLocationId('loc-downtown'), true);
  });
});
