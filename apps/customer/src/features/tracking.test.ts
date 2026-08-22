import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { simulateProgress, trackingView } from './tracking';

describe('trackingView', () => {
  it('walks the four visible steps', () => {
    assert.equal(trackingView('paid').activeIndex, 0);
    assert.equal(trackingView('in_progress').activeIndex, 1);
    assert.equal(trackingView('ready').activeIndex, 2);
    assert.equal(trackingView('picked_up').activeIndex, 3);
  });

  it('marks a cancellation instead of pretending progress', () => {
    const view = trackingView('cancelled');
    assert.equal(view.failed, 'cancelled');
    assert.equal(view.activeIndex, -1);
  });

  it('shows created as not-yet-started rather than crashing', () => {
    assert.equal(trackingView('created').activeIndex, -1);
  });
});

describe('simulateProgress', () => {
  it('advances through in_progress to ready and can be cancelled', () => {
    const fired: string[] = [];
    const pending: { callback: () => void; ms: number }[] = [];
    const cancel = simulateProgress(
      (status) => fired.push(status),
      ((callback: () => void, ms: number) => {
        pending.push({ callback, ms });
        return 0 as unknown as ReturnType<typeof setTimeout>;
      }) as typeof setTimeout,
    );
    assert.equal(pending.length, 2);
    assert.ok(pending[0].ms < pending[1].ms);
    pending[0].callback();
    pending[1].callback();
    assert.deepEqual(fired, ['in_progress', 'ready']);
    cancel();
  });
});
