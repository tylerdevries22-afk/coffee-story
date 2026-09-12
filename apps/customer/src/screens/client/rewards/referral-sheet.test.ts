/**
 * The referral sheet must not promise a credit nothing delivers, and must not
 * name another tenant's points.
 *
 * It promised "+20 Beans" and "You'll receive 20 Beans after your friend
 * joins and places their first eligible order". Two things were false at
 * once. Nothing credits a referral automatically: `PlaceOrderRequest` carries
 * no referral field and `complete_reward_referral_for_purchase` -- the
 * function the earn tab's own comment credited -- is defined nowhere in
 * packages/schema or packages/engine (the tripwire in tests/consistency pins
 * both). And "Beans" was hard-coded beside a POINTS_LABEL import, so a
 * construction franchise's guests were promised beans.
 *
 * #156 fixed the Referrals screen and the incoming-code banner onto one
 * sentence that names the only real path -- the team applying it at
 * checkout. This holds the sheet, the other place a share link is produced,
 * to the same sentence. Source assertions, matching home-screen.test.ts: the
 * app's tests run under node with no renderer, and the property pinned is
 * what the sheet says, not how it draws.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const REWARDS = join(process.cwd(), 'src', 'screens', 'client', 'rewards');
const sheet = readFileSync(join(REWARDS, 'referral-sheet.tsx'), 'utf8');
const earnTab = readFileSync(join(REWARDS, 'tabs', 'earn-tab.tsx'), 'utf8');

describe('referral sheet promises only what is real', () => {
  it('uses the one share sentence the Referrals screen already uses', () => {
    assert.match(sheet, /REFERRAL_SHARE_EXPLAINER/,
      'the sheet carries its own referral sentence instead of the shared one from features/referrals');
  });

  it('promises no automatic credit and no amount', () => {
    for (const promise of [
      /receive \d+/i,
      /after your friend/i,
      /awarded after/i,
      /first completed, paid order/i,
      /automatically/i,
      /\+\d+ \{?POINTS_LABEL/,
    ]) {
      assert.doesNotMatch(sheet, promise, `the sheet still promises an automatic credit: ${promise}`);
    }
  });

  /** A points noun beside a POINTS_LABEL import is the vocabulary leak, verbatim. */
  it('hard-codes no tenant points noun', () => {
    assert.doesNotMatch(sheet, /\bBeans\b/, 'the sheet names one tenant\'s points for every tenant');
  });

  it('no longer credits a function that does not exist', () => {
    assert.doesNotMatch(earnTab, /complete_reward_referral_for_purchase/,
      'earn-tab still explains referrals by a function defined nowhere');
    assert.match(earnTab, /referral-capability-preconditions/,
      'earn-tab should point at the tripwire that records what is missing');
  });
});
