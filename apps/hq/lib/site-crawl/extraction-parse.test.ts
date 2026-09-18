import assert from 'node:assert/strict';
import test from 'node:test';

import type { SiteCrawl } from './crawl-site';
import { MIN_CONFIDENCE, isLowConfidence, parseExtraction, priceNearName, type SiteExtraction } from './extraction-parse';
import { WWW, bakeryCrawl } from './site-fixtures.test-support';

const COLORS: SiteCrawl['colors'] = [{ hex: '#7A3E1D', names: ['theme-color'], uses: 1, neutral: false }];
const CRAWL = bakeryCrawl(COLORS);
const SUMMARY = 'Maple Row Bakehouse is a neighbourhood bakery in Ashford Springs baking sourdough and pastry every morning.';

function answer(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    summary: SUMMARY,
    colors: ['#7a3e1d', '#E8A948', '#7A3E1D', 'teal', '#2F5D3A'],
    logoUrl: `${WWW}/images/maple-row-logo.png`,
    items: [
      { name: 'Country Sourdough', description: 'Naturally leavened, 36-hour ferment.', priceCents: 900, category: 'Bread' },
      { name: 'Butter Croissant', description: null, priceCents: 425, category: 'Pastry' },
      { name: 'Seasonal Fruit Tart', description: null, priceCents: 650, category: 'Pastry' },
      { name: 'Almond Croissant', description: null, priceCents: 475, category: 'Pastry' },
      { name: 'country sourdough', description: null, priceCents: null, category: 'Bread' },
      { name: 'Oat Latte', description: '  ', priceCents: 5.5, category: 'Coffee' },
    ],
    confidence: 0.9,
    ...overrides,
  };
}

test('an answer is kept only as far as the site itself says it', () => {
  const extraction = parseExtraction(answer(), CRAWL);
  assert.ok(extraction !== null);
  assert.equal(extraction.summary, SUMMARY);
  assert.deepEqual(extraction.colors, ['#7A3E1D', '#E8A948', '#2F5D3A']);
  assert.equal(extraction.logoUrl, `${WWW}/images/maple-row-logo.png`);
  assert.deepEqual(extraction.items, [
    { name: 'Country Sourdough', description: 'Naturally leavened, 36-hour ferment.', priceCents: 900, category: 'Bread' },
    { name: 'Butter Croissant', description: null, priceCents: 425, category: 'Pastry' },
    // Named on the site, but the price the model gave is not printed there.
    { name: 'Seasonal Fruit Tart', description: null, priceCents: null, category: 'Pastry' },
    // A price must be whole cents.
    { name: 'Oat Latte', description: null, priceCents: null, category: 'Coffee' },
  ]);
  assert.equal(extraction.ungroundedItems, 1, 'the almond croissant is not on the site');
  assert.equal(extraction.confidence, 0.9);
});

test('a logo the crawl did not find is dropped, and confidence is clamped', () => {
  const invented = parseExtraction(answer({ logoUrl: 'https://cdn.example.net/invented-logo.png', confidence: 1.7 }), CRAWL);
  assert.equal(invented?.logoUrl, null);
  assert.equal(invented?.confidence, 1);
  assert.equal(parseExtraction(answer({ confidence: -3 }), CRAWL)?.confidence, 0);
  assert.equal(parseExtraction(answer({ confidence: 'high' }), CRAWL)?.confidence, 0);
});

test('an answer that is not a brand kit at all is refused', () => {
  for (const raw of [null, 'text', 42, answer({ summary: 7 }), answer({ colors: '#7A3E1D' }), answer({ items: {} })]) {
    assert.equal(parseExtraction(raw, CRAWL), null, JSON.stringify(raw));
  }
});

test('a price counts only when it is printed shortly after the item', () => {
  const corpus = 'country sourdough $9.00 naturally leavened seeded rye $10.50 cardamom bun 4.5 seasonal fruit tart 6 coffee';
  assert.equal(priceNearName(corpus, 'country sourdough', 900), true);
  assert.equal(priceNearName(corpus, 'cardamom bun', 450), true);
  assert.equal(priceNearName(corpus, 'seasonal fruit tart', 600), true);
  assert.equal(priceNearName(corpus, 'seasonal fruit tart', 650), false);
  assert.equal(priceNearName(corpus, 'seeded rye', 105), false);
  assert.equal(priceNearName('country sourdough $19.00', 'country sourdough', 900), false, 'a larger number is not the price');
  assert.equal(priceNearName(`country sourdough ${'x'.repeat(200)} $9.00`, 'country sourdough', 900), false);
  assert.equal(priceNearName(corpus, 'rye loaf', 1050), false);
});

function sampleExtraction(overrides: Partial<SiteExtraction> = {}): SiteExtraction {
  return { summary: SUMMARY, colors: ['#7A3E1D', '#E8A948'], logoUrl: null, items: [], confidence: 0.8, ungroundedItems: 0, ...overrides };
}

test('a doubtful, thin or mostly invented answer is low confidence', () => {
  const item = { name: 'Country Sourdough', description: null, priceCents: 900, category: null };
  assert.equal(isLowConfidence(sampleExtraction()), false);
  assert.equal(isLowConfidence(sampleExtraction({ confidence: MIN_CONFIDENCE - 0.01 })), true);
  assert.equal(isLowConfidence(sampleExtraction({ colors: ['#7A3E1D'] })), true);
  assert.equal(isLowConfidence(sampleExtraction({ summary: 'A bakery.' })), true);
  assert.equal(isLowConfidence(sampleExtraction({ items: [item], ungroundedItems: 2 })), true);
  assert.equal(isLowConfidence(sampleExtraction({ items: [item, item], ungroundedItems: 2 })), false);
});
