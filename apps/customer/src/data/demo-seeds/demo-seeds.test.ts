/**
 * The demo dataset must not leak one vertical's fixtures into another's.
 *
 * `demo.ts` used to branch on `IS_PROJECT_BUSINESS`, so every tenant that was
 * not a construction business got the coffee shop's demo history in the
 * client portal -- lattes, "Brew Club", oat-milk notes, coffee messages --
 * including a tenant declaring `business.industryKey: "generic"`. This
 * mirrors `home-industry-copy.test.ts`: the same two regexes, run against the
 * seed registry (`resolveDemoSeeds`) instead of the home screen's copy packs.
 *
 * Source-independent: this imports only the seed registry, not `demo.ts` or
 * `@/tenant`, so it holds for every tenant the platform could onboard.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { resolveDemoSeeds } from './index';
import type { IsoAt } from './types';

/** Words that belong to one vertical and must not escape it. */
const COFFEE_WORDS = /caf[eé]|latte|boba|espresso|matcha|mochi|barista|brew|coffee|drink|beans?\b/i;
const CONSTRUCTION_WORDS = /renovation|preconstruction|warranty|carpentry|jobsite|contractor/i;

const isoAt: IsoAt = (daysFromNow, hour, minute = 0) => {
  const value = new Date(2026, 0, 1);
  value.setDate(value.getDate() + daysFromNow);
  value.setHours(hour, minute, 0, 0);
  return value.toISOString();
};

function allText(industryKey: string): string {
  const seeds = resolveDemoSeeds(industryKey);
  return [
    ...seeds.orderSeeds.map((seed) => seed.item),
    ...seeds.rewardLedger(isoAt).map((entry) => entry.description),
    ...seeds.rewardActivities,
    ...seeds.rewardCatalog.flatMap((item) => [item.name, item.description ?? '']),
    ...seeds.giftCards(isoAt).flatMap((card) => [card.recipientName ?? '', card.designKey]),
    ...seeds.messages(isoAt).map((message) => message.body),
    seeds.preferenceNotes,
    seeds.membershipName,
  ].join(' | ');
}

describe('demo seed registry', () => {
  it('gives a generic tenant no coffee and no construction demo data', () => {
    const text = allText('generic');
    assert.doesNotMatch(text, COFFEE_WORDS,
      `a tenant declaring "generic" was handed coffee demo data: ${text}`);
    assert.doesNotMatch(text, CONSTRUCTION_WORDS,
      `a tenant declaring "generic" was handed construction demo data: ${text}`);
  });

  /**
   * The silent case. A vertical can be onboarded before its seed set exists,
   * and that tenant's demo mode must read as nobody's industry rather than
   * inheriting the launch tenant's history.
   */
  it('resolves an industry with no seed set to neutral, not to the launch tenant', () => {
    for (const key of ['dental-clinic', 'auto-repair', 'general', '', 'COFFEE-SHOP']) {
      const text = allText(key);
      assert.doesNotMatch(text, COFFEE_WORDS,
        `industry "${key}" has no seed set and fell back to coffee demo data: ${text}`);
    }
  });

  it('still gives coffee-story and stillpoint-builders their own demo data', () => {
    assert.match(allText('coffee-shop'), COFFEE_WORDS);
    assert.match(allText('construction'), CONSTRUCTION_WORDS);
    assert.doesNotMatch(allText('construction'), COFFEE_WORDS);
    assert.doesNotMatch(allText('coffee-shop'), CONSTRUCTION_WORDS);
  });
});
