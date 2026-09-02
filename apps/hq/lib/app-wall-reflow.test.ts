import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { boxesOverlap, boxOf, DEFAULT_BOUNDS, INITIAL_LAYOUT, layoutOverlaps, rotatedTile, tilesOverlap, type AppPreviewTile } from './app-wall-geometry';
import { openSlotNear, reflowTiles, reflowWithContacts } from './app-wall-reflow';

const tiles = () => Object.values(INITIAL_LAYOUT);

describe('reflowTiles', () => {
  it('places the dragged app at its target and settles every other app without collisions', () => {
    const moved = reflowTiles(tiles(), 'hq', { ...INITIAL_LAYOUT.hq, x: 30, y: 3 });
    assert.equal(moved.find((tile) => tile.key === 'hq')?.x, 30);
    assert.deepEqual(moved.map((tile) => tile.key), tiles().map((tile) => tile.key));
    assert.equal(layoutOverlaps(moved), false);
  });

  it('keeps fractional drag positions while the pointer is in motion', () => {
    const moved = reflowTiles(tiles(), 'hq', { ...INITIAL_LAYOUT.hq, x: 2.25, y: 4.25 });
    assert.equal(moved.find((tile) => tile.key === 'hq')?.x, 2.25);
    assert.equal(moved.find((tile) => tile.key === 'hq')?.y, 4.25);
  });

  it('allows a live resize while keeping every device collision-free', () => {
    const resized = reflowTiles(tiles(), 'customer', { ...INITIAL_LAYOUT.customer, width: 8.5 });
    assert.equal(resized.find((tile) => tile.key === 'customer')?.width, 8.5);
    assert.equal(layoutOverlaps(resized), false);
  });

  it('keeps the neighbours in place, but still moves the dragged device, when a drop cannot fit every device', () => {
    const result = reflowWithContacts(tiles(), 'hq', { ...INITIAL_LAYOUT.hq, width: 40, x: 0, y: 1 }, { columns: 60, rows: 40 });
    assert.equal(result.refused, true);
    assert.deepEqual(result.tiles.filter((tile) => tile.key !== 'hq'), tiles().filter((tile) => tile.key !== 'hq'));
    assert.equal(result.tiles.find((tile) => tile.key === 'hq')?.width, 40);
  });

  it('keeps every card collision-free across a continuous drag path', () => {
    let current = tiles();
    for (const [x, y] of [[5, 5], [12, 8], [20, 11], [28, 14], [34, 18]] as const) {
      const active = current.find((tile) => tile.key === 'hq');
      assert.ok(active);
      const result = reflowWithContacts(current, 'hq', { ...active, x, y });
      current = result.tiles;
      // A step the wall cannot seat still follows the hand; every seated step is collision-free.
      if (!result.refused) assert.equal(layoutOverlaps(current), false, `${x},${y}`);
      assert.equal(current.find((tile) => tile.key === 'hq')?.x, Math.min(x, 60 - active.width));
    }
  });

  it('rotating the kiosk to portrait parts its neighbours without overlap', () => {
    const turned = reflowTiles(tiles(), 'kiosk', rotatedTile(INITIAL_LAYOUT.kiosk));
    const kiosk = turned.find((tile) => tile.key === 'kiosk');
    assert.equal(kiosk?.orientation, 'portrait');
    assert.equal(layoutOverlaps(turned), false);
  });

  it('a mid-turn footprint override is what collision sees', () => {
    const wide = { width: 20, height: 14 };
    const result = reflowWithContacts(tiles(), 'kiosk', INITIAL_LAYOUT.kiosk, DEFAULT_BOUNDS, { footprint: wide });
    const kiosk = result.tiles.find((tile) => tile.key === 'kiosk');
    assert.ok(kiosk);
    const others = result.tiles.filter((tile) => tile.key !== 'kiosk');
    assert.equal(others.some((tile) => boxesOverlap(boxOf(tile), boxOf(kiosk, wide))), false);
    assert.ok(result.contacts.length > 0);
  });

  it('contacts name the pushed tile, the pusher and the push axis', () => {
    const result = reflowWithContacts(tiles(), 'customer', { ...INITIAL_LAYOUT.customer, x: 44, y: 26 });
    const contact = result.contacts.find((entry) => entry.key === 'operator');
    assert.ok(contact);
    assert.equal(contact.pushedBy, 'customer');
    assert.equal(contact.depth, 1);
    assert.ok(contact.axis === 'x' || contact.axis === 'y');
    assert.ok(contact.direction === 1 || contact.direction === -1);
  });

  it('chain pushes report increasing depth', () => {
    const row: AppPreviewTile[] = [
      { key: 'customer', x: 0, y: 4, width: 6, orientation: 'landscape', sized: false },
      { key: 'kiosk', x: 7, y: 4, width: 12, orientation: 'landscape', sized: false },
      { key: 'operator', x: 20, y: 4, width: 12, orientation: 'landscape', sized: false },
    ];
    const result = reflowWithContacts(row, 'customer', { ...row[0]!, x: 9 }, { columns: 40, rows: 20 });
    const kiosk = result.contacts.find((entry) => entry.key === 'kiosk');
    const operator = result.contacts.find((entry) => entry.key === 'operator');
    assert.equal(kiosk?.depth, 1);
    assert.equal(operator?.depth, 2);
    assert.equal(operator?.pushedBy, 'kiosk');
  });
});

describe('openSlotNear', () => {
  it('prefers the smallest displacement', () => {
    const occupied = [boxOf(INITIAL_LAYOUT.hq)];
    const slot = openSlotNear({ ...INITIAL_LAYOUT.customer, x: 26, y: 6 }, occupied);
    assert.ok(slot);
    assert.equal(slot.x, INITIAL_LAYOUT.hq.x + INITIAL_LAYOUT.hq.width + .35);
    assert.equal(slot.y, 6);
  });

  it('slides along the collider edge for fractional positions', () => {
    const occupied = [boxOf(INITIAL_LAYOUT.hq)];
    const slot = openSlotNear({ ...INITIAL_LAYOUT.customer, x: 26.4, y: 9.7 }, occupied);
    assert.ok(slot);
    assert.equal(slot.y, 9.7);
    assert.equal(occupied.some((box) => tilesOverlap(slot, { ...INITIAL_LAYOUT.hq, x: box.x })), false);
  });
});
