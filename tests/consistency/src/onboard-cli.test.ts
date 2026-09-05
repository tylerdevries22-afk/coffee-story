import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const ROOT = join(process.cwd(), '..', '..');

describe('tenant onboarding CLI', () => {
  it('applies the complete construction tenant to both guest binaries', () => {
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', join(ROOT, 'scripts', 'onboard.ts'), '--tenant', 'stillpoint-builders', '--apply'],
      { cwd: ROOT, encoding: 'utf8', timeout: 60_000 },
    );

    assert.equal(result.status, 0, result.error?.message ?? result.stderr);
    assert.match(result.stdout, /validated brand\.json and menu\.csv \(5 items\)/);
    assert.match(result.stdout, /customer: .*stillpoint-builders/);
    assert.match(result.stdout, /kiosk: .*stillpoint-builders/);
  });

  it('validates and would seed that same tenant without --apply', () => {
    // The gate is on applying it to a binary, not on the tenant existing.
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', join(ROOT, 'scripts', 'onboard.ts'), '--tenant', 'stillpoint-builders'],
      { cwd: ROOT, encoding: 'utf8', timeout: 60_000 },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /validated brand\.json/);
  });

  it('rejects --owner-user-id when its UUID value is missing', () => {
    const result = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        join(ROOT, 'scripts', 'onboard.ts'),
        '--tenant',
        'demo-roastery',
        '--owner-user-id',
      ],
      { cwd: ROOT, encoding: 'utf8', timeout: 10_000 },
    );

    assert.equal(result.status, 1, result.error?.message ?? result.stderr);
    assert.match(result.stderr, /--owner-user-id must be a valid UUID/);
  });
});
