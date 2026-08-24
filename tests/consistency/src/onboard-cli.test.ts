import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const ROOT = join(process.cwd(), '..', '..');
const TSX = join(ROOT, 'node_modules', '.bin', 'tsx');

describe('tenant onboarding CLI', () => {
  it('rejects --owner-user-id when its UUID value is missing', () => {
    const result = spawnSync(
      TSX,
      [join(ROOT, 'scripts', 'onboard.ts'), '--tenant', 'demo-roastery', '--owner-user-id'],
      { cwd: ROOT, encoding: 'utf8', timeout: 10_000 },
    );

    assert.equal(result.status, 1, result.error?.message ?? result.stderr);
    assert.match(result.stderr, /--owner-user-id must be a valid UUID/);
  });
});
