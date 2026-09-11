import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isOriginConnectionFailure } from './capture-surface-actions.mjs';
import { captureShots } from './capture-surface-shots.mjs';

describe('capture surface split', () => {
  it('keeps the complete unique capture matrix and injected origins', () => {
    const shots = captureShots({
      kiosk: 'https://kiosk.example',
      operator: 'https://operator.example',
      display: 'https://display.example',
      customer: 'https://customer.example',
      locationId: 'location-1',
    });
    assert.equal(shots.length, 15);
    assert.equal(new Set(shots.map(({ dir, name }) => `${dir}/${name}`)).size, shots.length);
    assert.equal(shots.find(({ name }) => name === '01-home')?.url, 'https://customer.example/');
    assert.equal(
      shots.find(({ name }) => name === '01-board-wall')?.url,
      'https://display.example/board/location-1',
    );
    assert.equal(typeof shots.find(({ name }) => name === '05-cart')?.prepare, 'function');
  });

  it('only classifies refused origin connections as unavailable', () => {
    assert.equal(isOriginConnectionFailure(new Error('net::ERR_CONNECTION_REFUSED')), true);
    assert.equal(isOriginConnectionFailure(new Error('HTTP 404')), false);
  });
});
