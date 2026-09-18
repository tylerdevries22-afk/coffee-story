import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { FatalError } from '@workflow/errors';

import { WWW, bakeryRoutes, siteTransport } from '../lib/site-crawl/site-fixtures.test-support';
import { researchBrand } from './factory-research';
import type { FactoryRunRow } from './factory-runtime';
import { SEARCH_LIMITS } from './research-limits';
import { isExtraction, outputText, stubResponses } from './responses-stub.test-support';

// No website: these runs take the hosted-search path, and nothing is crawled.
const RUN: FactoryRunRow = {
  id: 'run-1', businessName: 'Harbor Roast', tenantSlug: 'harbor-roast',
  industryKey: 'coffee-shop', locationName: 'Waterfront', supabaseRegion: 'us-west-1',
  surfaces: ['hq', 'customer'],
};
const SITE_RUN: FactoryRunRow = {
  ...RUN, id: 'run-2', businessName: 'Maple Row Bakehouse', tenantSlug: 'maple-row-bakehouse', websiteUrl: 'maplerowbakehouse.com',
};

const ARTIFACT = {
  summary: 'A waterfront coffee roaster serving espresso and pastries.',
  logoSourceUrl: null,
  colors: ['#1A2B3C', '#F0E0D0'],
  sources: [{ title: 'Harbor Roast', url: 'https://harbor.example' }],
};
const SITE_KIT = {
  summary: 'Maple Row Bakehouse is a neighbourhood bakery in Ashford Springs baking sourdough and pastry every morning.',
  colors: ['#7A3E1D', '#E8A948'],
  logoUrl: `${WWW}/images/maple-row-logo.png`,
  items: [{ name: 'Country Sourdough', description: null, priceCents: 900, category: 'Bread' }],
  confidence: 0.9,
};
const STYLESHEET = ':root { --brand-accent: #E8A948; }';

const VARIABLES = ['OPENAI_API_KEY', 'OPENAI_RESEARCH_MODEL', 'OPENAI_EXTRACTION_MODEL'] as const;
const original = Object.fromEntries(VARIABLES.map((name) => [name, process.env[name]]));
let stub: ReturnType<typeof stubResponses> | undefined;

function respondWith(payload: unknown): ReturnType<typeof stubResponses> {
  stub = stubResponses((body) => ({ payload: isExtraction(body) ? outputText(SITE_KIT) : payload }));
  return stub;
}

const completed = outputText(ARTIFACT);

describe('brand research spending bounds', () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'test-key-not-real';
    process.env.OPENAI_RESEARCH_MODEL = 'gpt-5-mini';
    delete process.env.OPENAI_EXTRACTION_MODEL;
  });
  afterEach(() => {
    stub?.restore();
    stub = undefined;
    for (const name of VARIABLES) {
      const value = original[name];
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  });

  it('caps searches and output, and asks a reasoning model for low effort', async () => {
    const { sent } = respondWith(completed);
    const artifact = await researchBrand(RUN);
    assert.equal(artifact.summary, ARTIFACT.summary);
    assert.equal(sent.length, 1);
    assert.equal(sent[0]?.body.max_tool_calls, SEARCH_LIMITS.brandResearch.maxToolCalls);
    assert.equal(sent[0]?.body.max_output_tokens, SEARCH_LIMITS.brandResearch.maxOutputTokens);
    assert.deepEqual(sent[0]?.body.reasoning, { effort: 'low' });
  });

  it('sends no reasoning effort to a model that does not reason', async () => {
    // An effort on a non-reasoning model is a 400 on every call.
    process.env.OPENAI_RESEARCH_MODEL = 'gpt-4.1-mini';
    const { sent } = respondWith(completed);
    await researchBrand(RUN);
    assert.equal('reasoning' in (sent[0]?.body ?? {}), false);
    assert.equal(sent[0]?.body.max_tool_calls, SEARCH_LIMITS.brandResearch.maxToolCalls);
  });

  it('stops for good when the output budget runs out, rather than paying again', async () => {
    respondWith({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [] });
    await assert.rejects(researchBrand(RUN),
      (error) => error instanceof FatalError && /max_output_tokens/.test(error.message));
  });

  it('does not retry a missing configuration', async () => {
    delete process.env.OPENAI_API_KEY;
    const { sent } = respondWith(completed);
    await assert.rejects(researchBrand(SITE_RUN, { transport: siteTransport(bakeryRoutes(STYLESHEET)) }),
      (error) => error instanceof FatalError);
    assert.equal(sent.length, 0, 'an unconfigured run must not reach the provider');
  });

  it('reads a run website instead of searching, and keeps what only the site says', async () => {
    const { sent } = respondWith(completed);
    const research = await researchBrand(SITE_RUN, { transport: siteTransport(bakeryRoutes(STYLESHEET)) });
    assert.equal(sent.length, 1);
    assert.equal(isExtraction(sent[0]?.body ?? {}), true);
    assert.equal('tools' in (sent[0]?.body ?? {}), false, 'reading the site needs no hosted search');
    assert.equal(research.summary, SITE_KIT.summary);
    assert.equal(research.site?.contactEmails[0], 'info@maplerowbakehouse.com');
  });

  it('falls back to capped search when the website gives nothing to build from', async () => {
    const { sent } = respondWith(completed);
    const research = await researchBrand(SITE_RUN, { transport: siteTransport({}) });
    assert.equal(research.summary, ARTIFACT.summary);
    assert.equal(research.site, undefined);
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0]?.body.tools, [{ type: 'web_search' }]);
    assert.equal(sent[0]?.body.max_tool_calls, SEARCH_LIMITS.brandResearch.maxToolCalls);
  });
});
