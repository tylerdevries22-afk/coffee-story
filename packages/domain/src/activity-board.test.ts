import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEFAULT_ACTIVITY_BOARD_CONFIG, activityInitials, resolveActivityBoardConfig,
} from './activity-board';

describe('resolveActivityBoardConfig', () => {
  it('is off unless the tenant explicitly selects activity mode', () => {
    assert.equal(resolveActivityBoardConfig(null).enabled, false);
    assert.equal(resolveActivityBoardConfig({ board: { mode: 'queue' } }).enabled, false);
  });

  it('reads a bounded Stillpoint activity board', () => {
    assert.deepEqual(resolveActivityBoardConfig({ board: {
      mode: 'activity', title: 'Field Activity', showAvatars: false, maxLines: 12,
    } }), { enabled: true, title: 'Field Activity', showAvatars: false, maxItems: 12 });
  });

  it('keeps safe defaults for malformed optional fields', () => {
    const result = resolveActivityBoardConfig({ board: {
      mode: 'activity', title: '', maxLines: 500,
    } });
    assert.equal(result.title, DEFAULT_ACTIVITY_BOARD_CONFIG.title);
    assert.equal(result.maxItems, DEFAULT_ACTIVITY_BOARD_CONFIG.maxItems);
  });
});

describe('activityInitials', () => {
  it('creates a compact avatar without exposing another identifier', () => {
    assert.equal(activityInitials('Maya Chen'), 'MC');
    assert.equal(activityInitials('  Óscar  '), 'Ó');
    assert.equal(activityInitials(''), '•');
  });
});
