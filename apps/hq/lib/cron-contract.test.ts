import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { cronPathsMissingGet, type CronEntry } from './cron-contract';

const APP = dirname(fileURLToPath(import.meta.url));

function realCrons(): CronEntry[] {
  const config = JSON.parse(readFileSync(join(APP, '../vercel.json'), 'utf8')) as {
    crons?: CronEntry[];
  };
  return config.crons ?? [];
}

function readRealRoute(path: string): string | null {
  try {
    return readFileSync(join(APP, '..', 'app', path, 'route.ts'), 'utf8');
  } catch {
    return null;
  }
}

describe('cronPathsMissingGet', () => {
  it('flags a route that only exports POST', () => {
    const missing = cronPathsMissingGet(
      [{ path: '/api/jobs/run', schedule: '*/5 * * * *' }],
      () => 'export async function POST(request: Request) { return Response.json({}); }',
    );
    assert.deepEqual(missing, ['/api/jobs/run']);
  });

  it('accepts a function declaration and a const binding alike', () => {
    const schedule = '*/5 * * * *';
    for (const source of ['export async function GET() {}', 'export const GET = POST;']) {
      assert.deepEqual(cronPathsMissingGet([{ path: '/api/jobs/run', schedule }], () => source), []);
    }
  });

  it('flags a schedule whose route file is gone', () => {
    const missing = cronPathsMissingGet([{ path: '/api/gone', schedule: '0 * * * *' }], () => null);
    assert.deepEqual(missing, ['/api/gone']);
  });

  /**
   * A word starting with GET must not count. `getSomething` is lowercase and
   * would not match anyway; `GETTER` would, without the boundary.
   */
  it('does not accept a longer name that merely starts with GET', () => {
    const missing = cronPathsMissingGet(
      [{ path: '/api/jobs/run', schedule: '*/5 * * * *' }],
      () => 'export const GETTER = 1;',
    );
    assert.deepEqual(missing, ['/api/jobs/run']);
  });
});

describe('the schedules this app actually ships', () => {
  /**
   * The drift check, in the shape of `deep-health.test.ts`: derived from the
   * real vercel.json and the real route files rather than from a fixture, so
   * adding a cron without a GET handler fails here instead of in production.
   */
  it('every scheduled path exports GET', () => {
    const crons = realCrons();
    assert.ok(crons.length > 0, 'vercel.json declares no crons; this check would be vacuous');
    assert.deepEqual(cronPathsMissingGet(crons, readRealRoute), []);
  });
});
