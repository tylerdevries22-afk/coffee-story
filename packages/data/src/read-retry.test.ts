import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { readWithRetry } from './read-retry';

describe('readWithRetry', () => {
  it('retries a resolved Supabase error and returns the next result', async () => {
    let calls = 0;
    const data = await readWithRetry('menu', async () => {
      calls += 1;
      return calls === 1
        ? { data: null, error: { message: 'offline' } }
        : { data: ['ready'], error: null };
    });
    assert.deepEqual(data, ['ready']);
    assert.equal(calls, 2);
  });

  it('aborts a hung read before trying again', async () => {
    const aborted: boolean[] = [];
    let calls = 0;
    const data = await readWithRetry('menu', (signal) => {
      calls += 1;
      if (calls === 2) return Promise.resolve({ data: 'ready', error: null });
      return new Promise<{ data: string | null; error: { message: string } | null }>((resolve) => {
        signal.addEventListener('abort', () => {
          aborted.push(true);
          resolve({ data: null, error: { message: 'aborted' } });
        }, { once: true });
      });
    }, { timeoutMs: 5 });
    assert.equal(data, 'ready');
    assert.deepEqual(aborted, [true]);
  });

  it('throws a structured operation error after both attempts fail', async () => {
    await assert.rejects(
      readWithRetry('brand bootstrap', async () => ({ data: null, error: { message: 'unavailable' } })),
      /brand bootstrap: unavailable/,
    );
  });
});
