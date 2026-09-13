/**
 * A tenant that is not a coffee shop must never be handed coffee wording.
 *
 * juniper-base-demo declares `business.industryKey: "generic"` and is applied
 * to the customer app, and its home screen advertised "Latte Lover", "Boba
 * Week" and "Inside the … café". The screen branched on
 * `Boolean(TENANT.copy.projectName)`, so every tenant that was not a
 * construction business fell into the coffee branch.
 *
 * These assertions run against the packs directly rather than the built
 * TENANT, so they hold for every tenant the platform could onboard rather than
 * only the three applied today.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { homeIndustryPack } from './home-industry-copy';

/** Words that belong to one vertical and must not escape it. */
const COFFEE_WORDS = /caf[eé]|latte|boba|espresso|matcha|mochi|barista|brew|coffee|drink|beans?\b/i;
const CONSTRUCTION_WORDS = /renovation|preconstruction|warranty|carpentry|jobsite|contractor/i;

function allText(industryKey: string): string {
  const pack = homeIndustryPack(industryKey);
  const copy = pack.copy('Juniper Base', 'Denver');
  return [
    pack.actionDetail,
    pack.cityFallback,
    ...pack.packages.flatMap((entry) => [entry.name, entry.detail, entry.price]),
    ...Object.values(copy),
  ].join(' | ');
}

describe('home industry packs', () => {
  it('gives a generic tenant no coffee and no construction wording', () => {
    const text = allText('generic');
    assert.doesNotMatch(text, COFFEE_WORDS,
      `a tenant declaring "generic" was handed coffee wording: ${text}`);
    assert.doesNotMatch(text, CONSTRUCTION_WORDS,
      `a tenant declaring "generic" was handed construction wording: ${text}`);
  });

  /**
   * The silent case. A vertical can be onboarded before its home pack exists,
   * and that tenant must read as nobody's industry rather than inheriting the
   * launch tenant's.
   */
  it('resolves an industry with no pack to neutral, not to the launch tenant', () => {
    for (const key of ['dental-clinic', 'auto-repair', 'general', '', 'COFFEE-SHOP']) {
      const text = allText(key);
      assert.doesNotMatch(text, COFFEE_WORDS,
        `industry "${key}" has no pack and fell back to coffee wording: ${text}`);
    }
  });

  it('still gives each known vertical its own voice', () => {
    assert.match(allText('coffee-shop'), COFFEE_WORDS);
    assert.match(allText('construction'), CONSTRUCTION_WORDS);
    assert.doesNotMatch(allText('construction'), COFFEE_WORDS);
  });

  /** The neutral pack has to be true for a consultancy and a shop at once. */
  it('names no product, venue or fulfillment model in the neutral pack', () => {
    assert.doesNotMatch(allText('generic'), /pickup|delivery|counter|table|menu\b|dish|cup\b/i);
  });
});
