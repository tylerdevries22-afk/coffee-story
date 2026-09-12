/**
 * An integration suite that wants to prove "this was not retried" counts the
 * attempts the transport received; it does not time the round trip. A
 * wall-clock bound turns a slow CI runner into a failed required check --
 * calendar-training asserted `Date.now() - startedAt < 5_000` for exactly
 * that -- and proves nothing about retries anyway, since two fast attempts
 * fit inside any bound. `serviceClient(transport)` in stack-runtime exists
 * so a suite can count instead.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const SUITES = join(process.cwd(), '..', '..', 'tests', 'integration', 'src');

describe('integration suites count attempts instead of timing them', () => {
  it('no suite bounds an elapsed time as its assertion', () => {
    for (const file of readdirSync(SUITES).filter((name) => name.endsWith('.test.ts'))) {
      const source = readFileSync(join(SUITES, file), 'utf8');
      assert.doesNotMatch(source, /(Date|performance)\.now\(\)\s*-\s*\w+\s*[<>]=?\s*\d/,
        `${file} asserts on elapsed wall-clock time; count the transport's attempts instead`);
    }
  });

  it('the harness still offers the transport hook the counting relies on', () => {
    const runtime = readFileSync(join(SUITES, 'stack-runtime.ts'), 'utf8');
    assert.match(runtime, /export function resilientFetchOver\(transport: typeof fetch\)/);
    assert.match(runtime, /export function serviceClient\(transport: typeof fetch = fetch\)/);
  });
});
