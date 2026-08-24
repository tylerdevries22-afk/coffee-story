import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { KioskUtility } from '@platform/domain';

import { utilityContentFor } from './utility-content';

const UTILITIES: readonly KioskUtility[] = ['rewards', 'giftBalance', 'allergens'];

describe('utilityContentFor', () => {
  it('gives every configured utility a useful label and full-screen explanation', () => {
    for (const utility of UTILITIES) {
      const content = utilityContentFor(utility);
      assert.ok(content.label.length > 0, `${utility} needs a label`);
      assert.ok(content.title.length > 0, `${utility} needs a title`);
      assert.ok(content.message.length > 0, `${utility} needs a message`);
    }
  });

  it('does not claim the kiosk can perform an integration it does not have', () => {
    assert.match(utilityContentFor('rewards').message, /cannot/i);
    assert.match(utilityContentFor('giftBalance').message, /cannot/i);
    assert.match(utilityContentFor('allergens').message, /not available/i);
  });
});
