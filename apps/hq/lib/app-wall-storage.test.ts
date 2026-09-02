import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { INITIAL_LAYOUT } from './app-wall-geometry';
import { defaultWallLayout, parseWallLayout, serializeWallLayout, WALL_STORAGE_KEY } from './app-wall-storage';

describe('app wall storage', () => {
  it('round-trips a layout', () => {
    const layout = { bounds: { columns: 60, rows: 28.5 }, tiles: defaultWallLayout().tiles.map((tile) => tile.key === 'kiosk' ? { ...tile, orientation: 'portrait' as const, sized: true } : tile) };
    assert.deepEqual(parseWallLayout(serializeWallLayout(layout)), layout);
    assert.equal(WALL_STORAGE_KEY, 'hq.apps-wall.layout.v1');
  });

  it('round-trips the persisted floor of an expanded row canvas', () => {
    const layout = { ...defaultWallLayout(), bounds: { columns: 60, rows: 75 }, rowFloor: 75 };
    assert.deepEqual(parseWallLayout(serializeWallLayout(layout)), layout);
  });

  it('rejects an unknown version', () => {
    assert.equal(parseWallLayout(JSON.stringify({ version: 2, bounds: { columns: 60, rows: 48 }, tiles: [] })), null);
  });

  it('drops malformed tile entries and fills missing apps from the default layout', () => {
    const raw = JSON.stringify({ version: 1, bounds: { columns: 60, rows: 48 }, tiles: [
      { key: 'hq', x: 1, y: 2, width: 20, orientation: 'landscape' },
      { key: 'kiosk', x: 'nope', y: 2, width: 20, orientation: 'landscape' },
      { key: 'hq', x: 9, y: 9, width: 9, orientation: 'landscape' },
      'garbage',
    ] });
    const layout = parseWallLayout(raw);
    assert.ok(layout);
    assert.deepEqual(layout.tiles.find((tile) => tile.key === 'hq'), { key: 'hq', x: 1, y: 2, width: 20, orientation: 'landscape', sized: false });
    assert.deepEqual(layout.tiles.find((tile) => tile.key === 'kiosk'), INITIAL_LAYOUT.kiosk);
    assert.equal(layout.tiles.length, 5);
  });

  it('ignores unknown app keys', () => {
    const layout = parseWallLayout(JSON.stringify({ version: 1, bounds: { columns: 60, rows: 48 }, tiles: [{ key: 'mystery', x: 1, y: 1, width: 5, orientation: 'landscape' }] }));
    assert.deepEqual(layout?.tiles, defaultWallLayout().tiles);
  });

  it('rejects non-finite numbers and invalid orientations', () => {
    // JSON cannot spell Infinity, but a hand-written record can overflow into it.
    const layout = parseWallLayout('{"version":1,"bounds":{"columns":60,"rows":48},"tiles":['
      + '{"key":"hq","x":1,"y":2,"width":1e400,"orientation":"landscape"},'
      + '{"key":"display","x":1,"y":2,"width":10,"orientation":"sideways"}]}');
    assert.deepEqual(layout?.tiles.find((tile) => tile.key === 'hq'), INITIAL_LAYOUT.hq);
    assert.deepEqual(layout?.tiles.find((tile) => tile.key === 'display'), INITIAL_LAYOUT.display);
    assert.equal(parseWallLayout(JSON.stringify({ version: 1, bounds: { columns: 60, rows: -2 }, tiles: [] })), null);
    assert.equal(parseWallLayout(JSON.stringify({ version: 1, bounds: { columns: 60, rows: 361 }, tiles: [] })), null);
  });

  it('returns null for invalid JSON', () => {
    assert.equal(parseWallLayout('{not json'), null);
    assert.equal(parseWallLayout(null), null);
    assert.equal(parseWallLayout('[]'), null);
  });

  it('rounds to two decimals when serializing', () => {
    const layout = { bounds: { columns: 60, rows: 28.123456 }, tiles: [{ ...INITIAL_LAYOUT.hq, x: 1.23456 }] };
    const record = JSON.parse(serializeWallLayout(layout)) as { bounds: { rows: number }; tiles: { x: number }[] };
    assert.equal(record.bounds.rows, 28.12);
    assert.equal(record.tiles[0]?.x, 1.23);
  });
});
