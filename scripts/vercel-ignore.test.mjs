import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { runIgnore } from './vercel-ignore.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APPS = ['customer', 'kiosk', 'operator', 'hq', 'display'];

function capture(app, files, env = { VERCEL_GIT_PREVIOUS_SHA: 'abc123' }) {
  const logs = [];
  const code = runIgnore({
    argv: ['node', 'vercel-ignore.mjs', app],
    env,
    git: {
      toplevel: () => '/repo',
      diffNames: () => files,
    },
    log: (line) => logs.push(line),
  });
  return { code, logs };
}

describe('vercel-ignore', () => {
  it('app-only path proceeds for that app', () => {
    const { code, logs } = capture('customer', ['apps/customer/src/app.tsx']);
    assert.equal(code, 1);
    assert.equal(logs.length, 1);
    assert.match(logs[0], /build customer/);
  });

  it('other-app path skips', () => {
    const { code, logs } = capture('customer', ['apps/kiosk/src/app.tsx']);
    assert.equal(code, 0);
    assert.equal(logs.length, 1);
    assert.match(logs[0], /skip customer/);
  });

  it('shared packages path proceeds for every app', () => {
    const files = ['packages/engine/src/orders.ts'];
    assert.equal(capture('customer', files).code, 1);
    assert.equal(capture('kiosk', files).code, 1);
    assert.equal(capture('operator', files).code, 1);
    assert.equal(capture('hq', files).code, 1);
    assert.equal(capture('display', files).code, 1);
  });

  it('hq scripts path proceeds only for hq', () => {
    const files = ['scripts/run-jobs.ts'];
    assert.equal(capture('hq', files).code, 1);
    assert.equal(capture('customer', files).code, 0);
    assert.equal(capture('kiosk', files).code, 0);
  });

  it('empty diff skips', () => {
    const { code, logs } = capture('operator', []);
    assert.equal(code, 0);
    assert.match(logs[0], /skip operator/);
  });

  it('fails open when previous SHA is missing', () => {
    const { code, logs } = capture('customer', [], {});
    assert.equal(code, 1);
    assert.match(logs[0], /missing VERCEL_GIT_PREVIOUS_SHA/);
  });

  it('fails open when git throws', () => {
    const logs = [];
    const code = runIgnore({
      argv: ['node', 'vercel-ignore.mjs', 'display'],
      env: { VERCEL_GIT_PREVIOUS_SHA: 'abc123' },
      git: {
        toplevel: () => {
          throw new Error('not a git repo');
        },
        diffNames: () => [],
      },
      log: (line) => logs.push(line),
    });
    assert.equal(code, 1);
    assert.match(logs[0], /git failed/);
  });
});

describe('vercel.json ignoreCommand', () => {
  for (const app of APPS) {
    it(`${app} points at the helper`, () => {
      const config = JSON.parse(readFileSync(join(ROOT, 'apps', app, 'vercel.json'), 'utf8'));
      assert.equal(
        config.ignoreCommand,
        `node "$(git rev-parse --show-toplevel)/scripts/vercel-ignore.mjs" ${app}`,
      );
    });
  }

  it('hq cron stays every five minutes', () => {
    const config = JSON.parse(readFileSync(join(ROOT, 'apps/hq/vercel.json'), 'utf8'));
    assert.deepEqual(config.crons, [{ path: '/api/jobs/run', schedule: '*/5 * * * *' }]);
  });
});

