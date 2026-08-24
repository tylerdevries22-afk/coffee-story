import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  PAIR_KEY_TARGET, pairingKeyColumns, pairingKeyRows, pairingPadHeight,
} from './pair-layout';

describe('pairing keypad layout', () => {
  it('keeps every key above the kiosk target floor', () => {
    assert.ok(PAIR_KEY_TARGET >= 60);
  });

  it('keeps all 29 controls visible on supported landscape tablets', () => {
    assert.ok(pairingKeyColumns(1024) >= 8);
    assert.ok(pairingKeyRows(29, 1024) <= 4);
    assert.ok(pairingPadHeight(29, 1024) <= 320);
    assert.ok(pairingPadHeight(29, 1366) <= 320);
  });
});
