import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { simulateProgress, trackingView } from './tracking';

describe('trackingView', () => {
  it('walks payment due through the four fulfilled states', () => {
    assert.equal(trackingView('created').activeIndex, 0);
    assert.equal(trackingView('paid').activeIndex, 1);
    assert.equal(trackingView('in_progress').activeIndex, 2);
    assert.equal(trackingView('ready').activeIndex, 3);
    assert.equal(trackingView('picked_up').activeIndex, 4);
  });

  it('marks a cancellation instead of pretending progress', () => {
    const view = trackingView('cancelled');
    assert.equal(view.failed, 'cancelled');
    assert.equal(view.activeIndex, -1);
  });

  it('explains how a created pay-at-pickup order advances', () => {
    assert.match(trackingView('created').steps[0]?.detail ?? '', /counter/);
  });

  it('uses project milestones without changing the shared status contract', () => {
    const view = trackingView('in_progress', 'construction');
    assert.equal(view.activeIndex, 2);
    assert.equal(view.steps[2]?.title, 'Work in progress');
    assert.match(view.steps[3]?.title ?? '', /Milestone/);
    assert.doesNotMatch(view.steps.map((step) => `${step.title} ${step.detail}`).join(' '),
      /coffee|counter|pickup|order/i);
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
