import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, type TestContext } from 'node:test';

import {
  parseWallLauncherArgs,
  previewCommandArgs,
  readBuiltTenant,
  wallLaunchPlan,
} from './wall-launch-config';

const root = join(import.meta.dirname, '..');

function fixture(t: TestContext): string {
  const directory = mkdtempSync(join(tmpdir(), 'wall-launch-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function writeBuild(directory: string, tenantKey: unknown): void {
  for (const app of ['customer', 'operator', 'kiosk']) {
    const path = join(directory, 'apps', app, 'dist-web');
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, 'index.html'), '<html></html>');
  }
  writeFileSync(join(directory, 'apps/customer/dist-web/wall-build-context.json'), JSON.stringify({ tenantKey }));
}

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
    assert.throws(() => parseWallLauncherArgs(['--tenant'], undefined), /valid tenant slug/);
    assert.throws(() => parseWallLauncherArgs(['--rebuild', '--rebuild'], undefined), /Duplicate/);
    assert.throws(() => parseWallLauncherArgs(['--tenant', 'a', '--tenant', 'b'], undefined), /Duplicate/);
    assert.throws(() => parseWallLauncherArgs([], '../invalid'), /invalid/);
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

  it('reads isolated tenant build fixtures without depending on ignored local exports', (t) => {
    const directory = fixture(t);
    assert.equal(readBuiltTenant(directory), undefined);
    writeBuild(directory, 'coffee-story');
    assert.equal(readBuiltTenant(directory), 'coffee-story');
    writeBuild(directory, 'stillpoint-builders');
    assert.equal(readBuiltTenant(directory), 'stillpoint-builders');
    rmSync(join(directory, 'apps/operator/dist-web/index.html'));
    assert.equal(readBuiltTenant(directory), undefined);
  });

  it('rejects malformed or unsafe build contexts', (t) => {
    const directory = fixture(t);
    writeBuild(directory, '../invalid');
    assert.throws(() => readBuiltTenant(directory), /invalid/);
    writeFileSync(join(directory, 'apps/customer/dist-web/wall-build-context.json'), '{');
    assert.throws(() => readBuiltTenant(directory), /unreadable/);
  });

  it('rejects malformed entries and duplicate names or ports with clear errors', (t) => {
    const directory = fixture(t);
    mkdirSync(join(directory, '.claude'));
    const source = JSON.parse(readFileSync(join(root, '.claude/launch.json'), 'utf8')) as {
      configurations: Record<string, unknown>[];
    };
    const entry = source.configurations[0];
    for (const configurations of [[null], [{ ...entry, runtimeArgs: 123 }], [entry, entry],
      [entry, { ...entry, name: 'other' }]]) {
      writeFileSync(join(directory, '.claude/launch.json'), JSON.stringify({ configurations }));
      assert.throws(() => wallLaunchPlan(directory, 'coffee-story'), /Every wall launch|unique/);
    }
  });
});
