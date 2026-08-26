import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { startSerializedPolling } from './polling';

const delay = (milliseconds: number) => new Promise<void>((resolve) => {
  setTimeout(resolve, milliseconds);
});

describe('startSerializedPolling', () => {
  it('never overlaps slow polls and stops without scheduling another run', async () => {
    const releases: (() => void)[] = [];
    let calls = 0;
    const stop = startSerializedPolling(() => new Promise<void>((resolve) => {
      calls += 1;
      releases.push(resolve);
    }), 1);

    await delay(5);
    assert.equal(calls, 1);
    releases.shift()?.();
    await delay(5);
    assert.equal(calls, 2);

    stop();
    releases.shift()?.();
    await delay(5);
    assert.equal(calls, 2);
  });
});
