import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { endOfDaySummary, type EodOrder } from './eod';

const order = (status: EodOrder['status'], totalCents: number, tipCents: number, lines: EodOrder['lines']): EodOrder =>
  ({ status, totalCents, tipCents, lines });

describe('endOfDaySummary', () => {
  it('totals the day and ranks the items', () => {
    const summary = endOfDaySummary([
      order('picked_up', 950, 100, [{ name: 'Cortado', quantity: 1 }, { name: 'Croissant', quantity: 1 }]),
      order('picked_up', 1200, 200, [{ name: 'Cortado', quantity: 2 }]),
      order('ready', 450, 0, [{ name: 'Cold Brew', quantity: 1 }]),
      order('refunded', 700, 0, [{ name: 'Latte', quantity: 1 }]),
      order('cancelled', 500, 0, [{ name: 'Latte', quantity: 1 }]),
    ]);
    assert.equal(summary.ordersCompleted, 3);
    assert.equal(summary.revenueCents, 2600);
    assert.equal(summary.tipsCents, 300);
    assert.equal(summary.averageOrderCents, 867);
    assert.equal(summary.refunds, 1);
    assert.equal(summary.cancellations, 1);
    assert.deepEqual(summary.topItems[0], { name: 'Cortado', quantity: 3 });
  });

  it('breaks item ties alphabetically so the list is stable', () => {
    const summary = endOfDaySummary([
      order('picked_up', 100, 0, [{ name: 'Zeppole', quantity: 1 }, { name: 'Americano', quantity: 1 }]),
    ]);
    assert.deepEqual(summary.topItems.map((item) => item.name), ['Americano', 'Zeppole']);
  });

  it('handles an empty day without dividing by zero', () => {
    const summary = endOfDaySummary([]);
    assert.equal(summary.averageOrderCents, 0);
    assert.equal(summary.ordersCompleted, 0);
  });
});
