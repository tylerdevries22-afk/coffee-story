/**
 * The profile screen must not collect a value nothing stores and then say it
 * saved.
 *
 * Birthday has no live column. mobile-api's updateProfile accepted the field
 * and dropped it on the floor -- its own comment said so -- while the screen
 * announced "Profile saved". Two things now hold that shut: the API boundary's
 * payload type no longer admits `birthday`, so a screen cannot hand it over
 * without a compile error; and the field is drawn only in demo mode, where
 * the demo store genuinely keeps it.
 *
 * Source assertions, matching home-screen.test.ts: this app's tests run under
 * node without a renderer, and the property being pinned is what the code
 * offers, not how it draws.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const SRC = join(process.cwd(), 'src');
const api = readFileSync(join(SRC, 'lib', 'mobile-api.ts'), 'utf8');
const screen = readFileSync(join(SRC, 'screens', 'client', 'more', 'profile-and-preferences.tsx'), 'utf8');

describe('profile birthday is not collected for a live account', () => {
  it('the live API boundary does not admit a birthday', () => {
    const signature = /updateProfile:\s*async\s*\(([\s\S]*?)\)\s*:\s*Promise<void>/.exec(api)?.[1] ?? '';
    assert.ok(signature.length > 0, 'updateProfile signature not found in mobile-api.ts');
    assert.doesNotMatch(signature, /'birthday'/,
      'updateProfile accepts a birthday the live profile cannot store');
  });

  it('the screen sends no birthday to the live API', () => {
    const liveCall = /mobileApi\.updateProfile\(\{([\s\S]*?)\}/.exec(screen)?.[1] ?? '';
    assert.ok(liveCall.length > 0, 'live updateProfile call not found in the screen');
    assert.doesNotMatch(liveCall, /birthday/);
  });

  it('draws the birthday field only where something keeps it', () => {
    const field = /(\{isDemo\s*\?\s*\(\s*)?<Field label="Birthday"/.exec(screen);
    assert.ok(field, 'Birthday field not found');
    assert.ok(field[1], 'the Birthday field is offered to live accounts, which have nowhere to store it');
  });
});
