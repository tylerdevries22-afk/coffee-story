import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const ROOT = join(process.cwd(), '..', '..');

describe('tenant onboarding CLI', () => {
  /**
   * A tenant with no storefront is a valid tenant and an invalid guest build.
   *
   * `stillpoint-builders` is a construction franchise that exists to be an
   * operator/HQ organization in the console's switcher. It ships no menu, no
   * location and no business block -- and the customer app reads
   * `business.monogram` and `location.timezone` off the brand file with no
   * fallback, so applying it produces a binary that crashes on its first
   * screen. The only thing that used to stop it was the customer shell's
   * artwork check, which is accidental protection, so this asserts the real
   * reason directly.
   */
  it('refuses to apply a tenant the guest apps would crash on, and says why', () => {
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', join(ROOT, 'scripts', 'onboard.ts'), '--tenant', 'stillpoint-builders', '--apply'],
      { cwd: ROOT, encoding: 'utf8', timeout: 60_000 },
    );

    assert.equal(result.status, 1, result.error?.message ?? result.stdout);
    assert.match(result.stderr, /business\.monogram/);
    assert.match(result.stderr, /location\.timezone/);
    assert.match(result.stderr, /cannot be a customer or kiosk build/);
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
