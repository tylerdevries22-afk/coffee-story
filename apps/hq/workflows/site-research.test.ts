import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { FatalError } from '@workflow/errors';

import { CrawlBudget } from '../lib/public-fetch';
import { APEX, WWW, bakeryRoutes, htmlReply, siteTransport } from '../lib/site-crawl/site-fixtures.test-support';
import type { FactoryRunRow } from './factory-runtime';
import { isExtraction, outputText, stubResponses } from './responses-stub.test-support';
import type { ExtractionConfig } from './site-extraction';
import { researchFromWebsite } from './site-research';

const STYLESHEET = ':root { --color-primary: #2F5D3A; }';
const RUN: FactoryRunRow = {
  id: 'run-9', businessName: 'Maple Row Bakehouse', tenantSlug: 'maple-row-bakehouse', industryKey: 'bakery',
  locationName: 'Maple Row', supabaseRegion: 'us-west-1', surfaces: ['hq', 'customer'], websiteUrl: 'maplerowbakehouse.com',
};
const CONFIG: ExtractionConfig = {
  apiKey: 'test-key-not-real', researchModel: 'gpt-5-mini', model: 'gpt-5-nano', escalationModel: 'gpt-5-mini',
};
const KIT = {
  summary: 'Maple Row Bakehouse is a neighbourhood bakery in Ashford Springs baking sourdough and pastry every morning.',
  colors: ['#7A3E1D', '#2F5D3A'],
  logoUrl: `${WWW}/images/maple-row-logo.png`,
  items: [{ name: 'Country Sourdough', description: null, priceCents: 900, category: 'Bread' }],
  confidence: 0.9,
};

describe('research from a business website', () => {
  let stub: ReturnType<typeof stubResponses> | undefined;
  afterEach(() => {
    stub?.restore();
    stub = undefined;
  });

  it('reads the site and asks the model once, with no hosted search', async () => {
    stub = stubResponses(() => ({ payload: outputText(KIT) }));
    const research = await researchFromWebsite(RUN, CONFIG, { transport: siteTransport(bakeryRoutes(STYLESHEET)) });
    assert.ok(research !== null);
    assert.equal(stub.sent.length, 1);
    assert.equal(isExtraction(stub.sent[0]?.body ?? {}), true);
    assert.equal('tools' in (stub.sent[0]?.body ?? {}), false);
    assert.equal(research.summary, KIT.summary);
    assert.deepEqual(research.colors, KIT.colors);
    assert.equal(research.logoSourceUrl, KIT.logoUrl);
    assert.deepEqual(research.sources.map((source) => source.url), [`${WWW}/`, `${WWW}/menu/`, `${WWW}/visit`, `${WWW}/our-story`]);
    assert.deepEqual(research.site.contactEmails, [
      'info@maplerowbakehouse.com', 'hello@maplerowbakehouse.com', 'orders@maplerowbakehouse.com', 'maplerowbakehouse@gmail.com',
    ]);
    assert.deepEqual(research.site.items, KIT.items);
    assert.deepEqual(research.site.extraction, { model: 'gpt-5-nano', confidence: 0.9, escalated: false, lowConfidence: false });
  });

  it('leaves a run without a website to search', async () => {
    stub = stubResponses(() => ({ payload: outputText(KIT) }));
    assert.equal(await researchFromWebsite({ ...RUN, websiteUrl: undefined }, CONFIG), null);
    assert.equal(stub.sent.length, 0);
  });

  it('sends the run to search when the site gives nothing to build from', async () => {
    stub = stubResponses(() => ({ payload: outputText(KIT) }));
    const closed = bakeryRoutes(STYLESHEET, {
      'https://maplerowbakehouse.com/robots.txt': { status: 200, headers: { 'content-type': 'text/plain' }, body: 'User-agent: *\nDisallow: /' },
    });
    const shell = bakeryRoutes(STYLESHEET, {
      [`${WWW}/`]: htmlReply('<!doctype html><title>Maple Row</title><div id="root"></div><script src="/app.js"></script>'),
    });
    const social = { ...bakeryRoutes(STYLESHEET), [APEX]: { status: 302, headers: { location: 'https://www.instagram.com/maplerowbakehouse/' } } };
    for (const routes of [closed, shell, social, {}]) {
      assert.equal(await researchFromWebsite(RUN, CONFIG, { transport: siteTransport(routes) }), null);
    }
    const spent = new CrawlBudget({ maxRequests: 0, maxBytes: 1, deadlineMs: 1_000 });
    assert.equal(await researchFromWebsite(RUN, CONFIG, { transport: siteTransport(bakeryRoutes(STYLESHEET)), budget: spent }), null);
    assert.equal(stub.sent.length, 0, 'nothing worth reading is never paid for');
  });

  it('sends the run to search when the kit would not pass as research', async () => {
    stub = stubResponses(() => ({ payload: outputText({ ...KIT, colors: ['#7A3E1D'] }) }));
    const research = await researchFromWebsite(RUN, { ...CONFIG, escalationModel: null }, { transport: siteTransport(bakeryRoutes(STYLESHEET)) });
    assert.equal(research, null);
    assert.equal(stub.sent.length, 1);
  });

  it('does not mistake a refused request for an unreadable site', async () => {
    stub = stubResponses(() => ({ status: 400, payload: { error: { message: 'Invalid schema.' } } }));
    await assert.rejects(researchFromWebsite(RUN, CONFIG, { transport: siteTransport(bakeryRoutes(STYLESHEET)) }),
      (error) => error instanceof FatalError);
  });
});
