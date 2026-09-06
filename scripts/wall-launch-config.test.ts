import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  parseWallLauncherArgs,
  previewCommandArgs,
  readBuiltTenant,
  wallLaunchPlan,
} from './wall-launch-config';

const root = join(import.meta.dirname, '..');

describe('wall launcher configuration', () => {
  it('uses an existing matching build unless a rebuild is explicit', () => {
    assert.deepEqual(
      previewCommandArgs('stillpoint-builders', 'stillpoint-builders', false),
      ['preview', '--wall', '--tenant', 'stillpoint-builders'],
    );
    assert.deepEqual(
      previewCommandArgs('coffee-story', 'stillpoint-builders', false),
      ['preview', '--tenant', 'coffee-story'],
    );
    assert.deepEqual(
      previewCommandArgs('coffee-story', 'coffee-story', true),
      ['preview', '--tenant', 'coffee-story'],
    );
  });

  it('validates command options and tenant conflicts', () => {
    assert.deepEqual(parseWallLauncherArgs(['--tenant', 'coffee-story'], undefined), {
      requestedTenant: 'coffee-story', rebuild: false,
    });
    assert.throws(() => parseWallLauncherArgs(['--open'], undefined), /Unsupported/);
    assert.throws(
      () => parseWallLauncherArgs(['--tenant', 'coffee-story'], 'stillpoint-builders'),
      /conflicts/,
    );
  });

  it('derives five health-checked processes from canonical project config', () => {
    const plan = wallLaunchPlan(root, 'stillpoint-builders');
    assert.equal(plan.length, 5);
    assert.equal(new Set(plan.map(({ port }) => port)).size, 5);
    assert.equal(plan.find(({ name }) => name === 'display')?.env.TENANT, 'stillpoint-builders');
    assert.equal(plan.find(({ name }) => name === 'operator-web')?.url, 'http://127.0.0.1:4191/');
  });

  it('reads the tenant identity baked into the current wall', () => {
    assert.equal(readBuiltTenant(root), 'stillpoint-builders');
  });
});
