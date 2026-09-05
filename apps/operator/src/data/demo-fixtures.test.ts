import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { before, describe, it } from 'node:test';

let demoFixturesFor: typeof import('./demo-fixtures').demoFixturesFor;

before(async () => {
  const assetRequire = createRequire(import.meta.url);
  assetRequire.extensions['.webp'] = (module, filename) => { module.exports = filename; };
  ({ demoFixturesFor } = await import('./demo-fixtures'));
});

describe('demoFixturesFor', () => {
  it('keeps the rich launch demo when no tenant or the launch tenant is selected', () => {
    for (const slug of [undefined, 'coffee-story']) {
      const fixtures = demoFixturesFor(slug);
      assert.equal(fixtures.launch, true);
      assert.ok(fixtures.staffDashboard.orders.length > 0);
      assert.ok(fixtures.orderableItems.length > 0);
      assert.ok(fixtures.boardOrders.length > 0);
      assert.ok(fixtures.shifts.length > 0);
      assert.ok(fixtures.prepBatches.length > 0);
      assert.ok(fixtures.calendarItems.length > 0);
    }
  });

  it('gives Stillpoint only tenant-owned activity fixtures', () => {
    const fixtures = demoFixturesFor('stillpoint-builders');
    assert.equal(fixtures.launch, false);
    assert.deepEqual(fixtures.staffDashboard.orders, []);
    assert.deepEqual(fixtures.orderableItems, []);
    assert.deepEqual(fixtures.boardOrders, []);
    assert.deepEqual(fixtures.shifts, []);
    assert.deepEqual(fixtures.prepBatches, []);
    assert.deepEqual(fixtures.calendarItems, []);
  });

  it('uses the same empty base for an unknown explicit tenant', () => {
    const fixtures = demoFixturesFor('neutral-demo');
    assert.equal(fixtures.launch, false);
    assert.deepEqual(fixtures, demoFixturesFor('another-neutral-demo'));
  });
});
