import assert from 'node:assert/strict';
import { it } from 'node:test';

import { runIndependentCronStages } from './cron-stage-runner';

it('returns each successful stage result under its original name', async () => {
  const result = await runIndependentCronStages({
    drops: async () => 2,
    campaigns: async () => 3,
  });

  assert.deepEqual(result, { drops: 2, campaigns: 3 });
});

it('finishes every independent stage before reporting a named failure', async () => {
  let finishHealthy: (() => void) | undefined;
  let healthyFinished = false;
  const healthyGate = new Promise<void>((resolve) => { finishHealthy = resolve; });
  const failure = new Error('drops unavailable');
  const result = runIndependentCronStages({
    drops: async () => { throw failure; },
    campaigns: async () => {
      await healthyGate;
      healthyFinished = true;
      return 3;
    },
  });

  await Promise.resolve();
  assert.equal(healthyFinished, false);
  finishHealthy?.();
  await assert.rejects(result, (error) => {
    assert.ok(error instanceof AggregateError);
    assert.match(error.errors[0]?.message ?? '', /drops/);
    assert.equal(error.errors[0]?.cause, failure);
    return true;
  });
  assert.equal(healthyFinished, true);
});
