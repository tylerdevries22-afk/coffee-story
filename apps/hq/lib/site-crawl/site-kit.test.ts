import assert from 'node:assert/strict';
import test from 'node:test';

import type { SiteCrawl } from './crawl-site';
import type { SiteExtraction } from './extraction-parse';
import { WWW, bakeryCrawl } from './site-fixtures.test-support';
import { brandResearchFromKit, buildSiteBrandKit, type ExtractionProvenance } from './site-kit';

const COLORS: SiteCrawl['colors'] = [{ hex: '#7A3E1D', names: ['theme-color'], uses: 1, neutral: false }];
const EXTRACTION: SiteExtraction = {
  summary: 'Maple Row Bakehouse is a neighbourhood bakery in Ashford Springs baking sourdough and pastry every morning.',
  colors: ['#7A3E1D', '#E8A948'],
  logoUrl: `${WWW}/images/maple-row-logo.png`,
  items: [{ name: 'Country Sourdough', description: null, priceCents: 900, category: 'Bread' }],
  confidence: 0.85,
  ungroundedItems: 0,
};
const PROVENANCE: ExtractionProvenance = { model: 'gpt-5-nano', confidence: 0.85, escalated: false, lowConfidence: false };

test('the kit takes facts from the crawl and judgement from the model', () => {
  const crawl = bakeryCrawl(COLORS);
  const kit = buildSiteBrandKit(crawl, EXTRACTION, PROVENANCE);
  assert.equal(kit.website, `${WWW}/`);
  assert.equal(kit.name, 'Maple Row Bakehouse');
  assert.equal(kit.summary, EXTRACTION.summary);
  assert.deepEqual(kit.colors, ['#7A3E1D', '#E8A948']);
  assert.equal(kit.logoUrl, `${WWW}/images/maple-row-logo.png`);
  assert.deepEqual(kit.items, EXTRACTION.items);
  assert.deepEqual(kit.contactEmails, ['info@maplerowbakehouse.com', 'maplerowbakehouse@gmail.com']);
  assert.deepEqual(kit.socialLinks, crawl.socialLinks);
  assert.deepEqual(kit.imageUrls, [`${WWW}/images/croissants-1600.jpg`, `${WWW}/images/menu/sourdough.jpg`]);
  assert.deepEqual(kit.pages.map((page) => page.topic), ['home', 'menu', 'contact', 'about']);
  assert.ok(!('text' in (kit.pages[0] ?? {})), 'page text stays out of the saved kit');
  assert.deepEqual(kit.extraction, PROVENANCE);
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(kit)));
});

test('the kit fills the same research artifact a search answer does, checked the same way', () => {
  const kit = buildSiteBrandKit(bakeryCrawl(COLORS), EXTRACTION, PROVENANCE);
  const artifact = brandResearchFromKit(kit);
  assert.deepEqual(artifact, {
    summary: EXTRACTION.summary,
    colors: ['#7A3E1D', '#E8A948'],
    sources: [
      { title: 'Maple Row Bakehouse | Bread, Pastry & Coffee in Ashford Springs', url: `${WWW}/` },
      { title: 'Menu | Maple Row Bakehouse', url: `${WWW}/menu/` },
      { title: 'Visit | Maple Row Bakehouse', url: `${WWW}/visit` },
      { title: 'Our Story | Maple Row Bakehouse', url: `${WWW}/our-story` },
    ],
    logoSourceUrl: `${WWW}/images/maple-row-logo.png`,
  });
});

test('an untitled page is named from the site and its topic, and pages past twelve are not sources', () => {
  const pages = Array.from({ length: 14 }, (_, index) => ({
    url: `${WWW}/menu-${index}`, topic: 'menu' as const, title: index === 0 ? null : `Menu ${index}`, text: '',
  }));
  const crawl = bakeryCrawl(COLORS, { pages, name: null });
  const artifact = brandResearchFromKit(buildSiteBrandKit(crawl, { ...EXTRACTION, logoUrl: null }, PROVENANCE));
  assert.equal(artifact?.sources.length, 12);
  assert.deepEqual(artifact?.sources[0], { title: 'www.maplerowbakehouse.com Menu', url: `${WWW}/menu-0` });
  assert.equal(artifact !== null && 'logoSourceUrl' in artifact, false);
});

test('a kit that would not pass as research is refused rather than patched', () => {
  const crawl = bakeryCrawl(COLORS);
  assert.equal(brandResearchFromKit(buildSiteBrandKit(crawl, { ...EXTRACTION, colors: ['#7A3E1D'] }, PROVENANCE)), null);
  assert.equal(brandResearchFromKit(buildSiteBrandKit(crawl, { ...EXTRACTION, summary: 'A bakery.' }, PROVENANCE)), null);
  assert.equal(brandResearchFromKit(buildSiteBrandKit(crawl, EXTRACTION, PROVENANCE)) === null, false);
});
