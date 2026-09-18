/**
 * Which of the console's four industries a Google listing most likely is.
 *
 * Google leads with one `primaryType` and lists others after it. Read in
 * order of how much each says:
 *
 * | Evidence                                    | Industry      | Confidence |
 * | ------------------------------------------- | ------------- | ---------- |
 * | primary type is what the industry is for    | that industry | high       |
 * | primary type is a close neighbour           | that industry | medium     |
 * | a secondary type is what an industry is for | that industry | medium     |
 * | a secondary type is a close neighbour       | that industry | low        |
 * | anything that only says "serves food"       | coffee-shop   | low        |
 * | nothing recognised                          | general       | low        |
 *
 * Food service lands on the café blueprint because it is the nearest one with
 * ordering in it, not because a pizzeria is a café -- which is why it is low.
 * The wizard shows the reason beside the choice and never locks it: this is a
 * starting point for an operator's review, not a classification.
 */
import { isLodging } from '@platform/engine';

import type { IndustryKey } from './org-input';

export type IndustryConfidence = 'high' | 'medium' | 'low';

export type IndustrySuggestion = {
  readonly key: IndustryKey;
  readonly confidence: IndustryConfidence;
  /** One sentence for the operator: what Google said, and so what this is. */
  readonly reason: string;
};

type Named = Exclude<IndustryKey, 'general'>;
type Test = (type: string) => boolean;

const CAFE = new Set([
  'coffee_shop', 'cafe', 'coffee_roastery', 'coffee_stand', 'tea_house', 'cat_cafe', 'dog_cafe',
]);
const COUNTER_FOOD = new Set([
  'bakery', 'bagel_shop', 'cake_shop', 'pastry_shop', 'donut_shop', 'dessert_shop',
  'ice_cream_shop', 'juice_shop', 'acai_shop', 'sandwich_shop', 'deli', 'breakfast_restaurant',
  'brunch_restaurant', 'confectionery', 'chocolate_shop', 'snack_bar', 'salad_shop',
]);
const TRADES = new Set(['general_contractor', 'roofing_contractor', 'electrician', 'plumber', 'painter']);
const FIELD_SERVICE = new Set(['locksmith', 'moving_company']);
const VENUES = new Set([
  'event_venue', 'wedding_venue', 'banquet_hall', 'convention_center', 'campground',
  'camping_cabin', 'rv_park', 'japanese_inn', 'budget_japanese_inn', 'private_guest_room',
]);
const EATERIES = new Set([
  'food', 'restaurant', 'bar', 'pub', 'bistro', 'diner', 'cafeteria', 'food_court', 'gastropub',
  'brewpub', 'brewery', 'winery', 'beer_garden', 'meal_takeaway', 'meal_delivery', 'steak_house',
  'noodle_shop', 'kebab_shop', 'hot_dog_stand', 'pizza_delivery', 'irish_pub',
]);

/** Checked in this order, so a listing that fits two keeps the stronger claim. */
const ORDER: readonly Named[] = ['coffee-shop', 'hospitality', 'construction'];

const FOR: Readonly<Record<Named, Test>> = {
  'coffee-shop': (type) => CAFE.has(type),
  // The engine's own lodging list, so "is this a hotel" has one answer.
  hospitality: (type) => isLodging({ types: [type] }),
  // Google keeps adding trades; every one it has named so far ends this way.
  construction: (type) => TRADES.has(type) || type.endsWith('_contractor'),
};
const NEAR: Readonly<Record<Named, Test>> = {
  'coffee-shop': (type) => COUNTER_FOOD.has(type),
  hospitality: (type) => VENUES.has(type),
  construction: (type) => FIELD_SERVICE.has(type),
};

function servesFood(type: string): boolean {
  return EATERIES.has(type) || type.endsWith('_restaurant') || type.endsWith('_bar');
}

function match(tests: Readonly<Record<Named, Test>>, type: string): Named | null {
  return ORDER.find((key) => tests[key](type)) ?? null;
}

function quoted(type: string): string {
  return `“${type.replaceAll('_', ' ')}”`;
}

export function suggestIndustry(place: {
  readonly primaryType: string | null;
  readonly types: readonly string[];
}): IndustrySuggestion {
  const primary = place.primaryType;
  const others = place.types.filter((type) => type !== primary);
  if (primary !== null) {
    const key = match(FOR, primary);
    if (key) return { key, confidence: 'high', reason: `Google lists it as ${quoted(primary)}.` };
    const near = match(NEAR, primary);
    if (near) {
      return { key: near, confidence: 'medium',
        reason: `Google lists it as ${quoted(primary)}, which is close to this industry.` };
    }
  }
  for (const [tests, confidence] of [[FOR, 'medium'], [NEAR, 'low']] as const) {
    for (const type of others) {
      const key = match(tests, type);
      if (key) return { key, confidence, reason: `Google also lists it as ${quoted(type)}.` };
    }
  }
  const food = [primary, ...others].find((type): type is string => type !== null && servesFood(type));
  if (food) {
    return { key: 'coffee-shop', confidence: 'low',
      reason: `Google lists it as ${quoted(food)}; the café blueprint is the nearest one with ordering.` };
  }
  return { key: 'general', confidence: 'low',
    reason: primary === null
      ? 'Google gives no category for it.'
      : `Google lists it as ${quoted(primary)}, which matches no specific industry.` };
}
