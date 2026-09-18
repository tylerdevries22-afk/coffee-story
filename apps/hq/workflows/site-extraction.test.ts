import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { FatalError } from '@workflow/errors';

import type { SiteCrawl } from '../lib/site-crawl/crawl-site';
import { WWW, bakeryCrawl } from '../lib/site-crawl/site-fixtures.test-support';
import { EXTRACTION_LIMITS } from './research-limits';
import { outputText, stubResponses, usageBlock } from './responses-stub.test-support';
import {
  billedUsage, extractSiteBrand, extractionConfig, type ExtractionConfig, type ExtractionUsage,
} from './site-extraction';
import { EXTRACTION_INSTRUCTIONS, extractionRequestBody, extractionSchema } from './site-extraction-request';

const COLORS: SiteCrawl['colors'] = [{ hex: '#7A3E1D', names: ['theme-color'], uses: 1, neutral: false }];
const CRAWL = bakeryCrawl(COLORS);
const LOGOS = [`${WWW}/images/maple-row-logo.png`, `${WWW}/apple-touch-icon.png`];
const CONFIG: ExtractionConfig = {
  apiKey: 'test-key-not-real', researchModel: 'gpt-5-mini', model: 'gpt-5-nano', escalationModel: 'gpt-5-mini',
};
const CONTEXT = { businessName: 'Maple Row Bakehouse', runId: 'run-7' };
const CONFIDENT = {
  summary: 'Maple Row Bakehouse is a neighbourhood bakery in Ashford Springs baking sourdough and pastry every morning.',
  colors: ['#7A3E1D', '#E8A948'],
  logoUrl: LOGOS[0],
  items: [{ name: 'Country Sourdough', description: null, priceCents: 900, category: 'Bread' }],
  confidence: 0.9,
};
const DOUBTFUL = { ...CONFIDENT, confidence: 0.3 };

const isRetryable = (error: unknown): boolean => error instanceof Error && !(error instanceof FatalError);

describe('extraction configuration', () => {
  it('uses the extraction model first, and escalates only to a different model', () => {
    assert.deepEqual(extractionConfig({ OPENAI_API_KEY: 'test-key-not-real', OPENAI_RESEARCH_MODEL: 'gpt-5-mini' }), {
      apiKey: 'test-key-not-real', researchModel: 'gpt-5-mini', model: 'gpt-5-mini', escalationModel: null,
    });
    const both = { OPENAI_API_KEY: 'test-key-not-real', OPENAI_RESEARCH_MODEL: 'gpt-5-mini', OPENAI_EXTRACTION_MODEL: ' gpt-5-nano ' };
    assert.deepEqual(extractionConfig(both), CONFIG);
    assert.equal(extractionConfig({ ...both, OPENAI_EXTRACTION_MODEL: 'gpt-5-mini' }).escalationModel, null);
  });

  it('refuses for good when the key or the research model is missing', () => {
    for (const environment of [
      {}, { OPENAI_API_KEY: 'test-key-not-real' }, { OPENAI_RESEARCH_MODEL: 'gpt-5-mini' },
      { OPENAI_API_KEY: '  ', OPENAI_RESEARCH_MODEL: 'gpt-5-mini', OPENAI_EXTRACTION_MODEL: 'gpt-5-nano' },
    ]) {
      assert.throws(() => extractionConfig(environment), FatalError);
    }
  });
});

describe('billed usage', () => {
  it('counts only what the provider reported, as non-negative whole tokens', () => {
    assert.deepEqual(billedUsage('gpt-5-nano', usageBlock(3_000, 500, 200)),
      { model: 'gpt-5-nano', inputTokens: 2_500, cachedInputTokens: 500, outputTokens: 200 });
    assert.deepEqual(billedUsage('gpt-5-nano', undefined), { model: 'gpt-5-nano', inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 });
    assert.deepEqual(billedUsage('gpt-5-nano', { input_tokens: -4, input_tokens_details: null, output_tokens: 'many' }),
      { model: 'gpt-5-nano', inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 });
    assert.deepEqual(billedUsage('gpt-5-nano', { input_tokens: 10.7, output_tokens: 3 }),
      { model: 'gpt-5-nano', inputTokens: 10, cachedInputTokens: 0, outputTokens: 3 });
  });
});

describe('the extraction request', () => {
  it('asks once, strictly, with no tools, a hard output cap and nothing stored', () => {
    const body = extractionRequestBody('gpt-5-nano', CRAWL, 'Maple Row Bakehouse');
    assert.equal(body.model, 'gpt-5-nano');
    assert.equal(body.instructions, EXTRACTION_INSTRUCTIONS);
    assert.equal('tools' in body, false);
    assert.equal('max_tool_calls' in body, false);
    assert.equal(body.max_output_tokens, EXTRACTION_LIMITS.siteBrandKit.maxOutputTokens);
    assert.deepEqual(body.reasoning, { effort: 'low' });
    assert.equal(body.store, false);
    assert.equal(typeof body.input, 'string');
    assert.ok(String(body.input).length <= EXTRACTION_LIMITS.siteBrandKit.maxInputChars);
    assert.match(String(body.input), /## Menu page: https:\/\/www\.maplerowbakehouse\.com\/menu\//);
    assert.deepEqual(body.text, {
      format: { type: 'json_schema', name: 'platform_site_brand_kit', strict: true, schema: extractionSchema(LOGOS) },
    });
    assert.equal(extractionRequestBody('gpt-4.1-nano', CRAWL, 'Maple Row Bakehouse').reasoning, undefined);
  });

  it('lets the model choose a logo only among the ones found, and never asks for an email', () => {
    const properties = extractionSchema(LOGOS).properties as Record<string, unknown>;
    assert.deepEqual(properties.logoUrl, { type: ['string', 'null'], enum: [...LOGOS, null] });
    assert.deepEqual((extractionSchema([]).properties as Record<string, unknown>).logoUrl, { type: 'null' });
    const items = properties.items as { maxItems: number; items: { properties: Record<string, unknown> } };
    assert.equal(items.maxItems, EXTRACTION_LIMITS.siteBrandKit.maxItems);
    assert.deepEqual(items.items.properties.priceCents, { type: ['integer', 'null'], minimum: 0, maximum: 10_000_000 });
    assert.doesNotMatch(JSON.stringify(extractionSchema(LOGOS)), /email/i);
    assert.doesNotMatch(EXTRACTION_INSTRUCTIONS, /email/i);
  });
});

describe('extracting a brand kit', () => {
  let stub: ReturnType<typeof stubResponses> | undefined;
  afterEach(() => {
    stub?.restore();
    stub = undefined;
  });

  it('keeps a confident first answer from the cheap model', async () => {
    stub = stubResponses(() => ({ payload: outputText(CONFIDENT) }));
    const outcome = await extractSiteBrand(CRAWL, CONTEXT, CONFIG);
    assert.equal(outcome.model, 'gpt-5-nano');
    assert.equal(outcome.escalated, false);
    assert.equal(outcome.extraction.items[0]?.priceCents, 900);
    assert.equal(stub.sent.length, 1);
    assert.equal(stub.sent[0]?.url, 'https://api.openai.com/v1/responses');
    assert.equal(stub.sent[0]?.headers.get('idempotency-key'), 'platform-site-run-7-gpt-5-nano');
    assert.equal(stub.sent[0]?.headers.get('authorization'), 'Bearer test-key-not-real');
  });

  it('pays for the research model only when the first answer is doubtful', async () => {
    stub = stubResponses((body) => ({ payload: outputText(body.model === 'gpt-5-nano' ? DOUBTFUL : CONFIDENT) }));
    const outcome = await extractSiteBrand(CRAWL, CONTEXT, CONFIG);
    assert.deepEqual(stub.sent.map((request) => request.body.model), ['gpt-5-nano', 'gpt-5-mini']);
    assert.equal(outcome.model, 'gpt-5-mini');
    assert.equal(outcome.escalated, true);
    assert.equal(outcome.extraction.confidence, 0.9);
  });

  it('keeps a doubtful answer when there is no stronger model to ask', async () => {
    stub = stubResponses(() => ({ payload: outputText(DOUBTFUL) }));
    const outcome = await extractSiteBrand(CRAWL, CONTEXT, { ...CONFIG, model: 'gpt-5-mini', escalationModel: null });
    assert.equal(stub.sent.length, 1);
    assert.equal(outcome.escalated, false);
    assert.equal(outcome.extraction.confidence, 0.3);
  });

  it('stops for good on a truncated answer', async () => {
    stub = stubResponses(() => ({ payload: { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [] } }));
    await assert.rejects(extractSiteBrand(CRAWL, CONTEXT, CONFIG),
      (error) => error instanceof FatalError && /max_output_tokens/.test(error.message));
  });

  it('stops for good when the provider refuses the request itself', async () => {
    stub = stubResponses(() => ({ status: 400, payload: { error: { message: 'Invalid schema.' } } }));
    const passes: ExtractionUsage[] = [];
    const context = { ...CONTEXT, onUsage: (pass: ExtractionUsage) => { passes.push(pass); } };
    await assert.rejects(extractSiteBrand(CRAWL, context, CONFIG), (error) => error instanceof FatalError && /400/.test(error.message));
    assert.equal(stub.sent.length, 1, 'a malformed request is not paid for twice');
    assert.deepEqual(passes, [], 'a refused request is not billed');
  });

  it('reports what each billed pass used, uncached and cached input apart', async () => {
    stub = stubResponses((body) => ({
      payload: body.model === 'gpt-5-nano'
        ? outputText(DOUBTFUL, usageBlock(12_000, 2_000, 900))
        : outputText(CONFIDENT, usageBlock(12_500, 0, 1_400)),
    }));
    const passes: ExtractionUsage[] = [];
    await extractSiteBrand(CRAWL, { ...CONTEXT, onUsage: (pass) => { passes.push(pass); } }, CONFIG);
    assert.deepEqual(passes, [
      { model: 'gpt-5-nano', inputTokens: 10_000, cachedInputTokens: 2_000, outputTokens: 900 },
      { model: 'gpt-5-mini', inputTokens: 12_500, cachedInputTokens: 0, outputTokens: 1_400 },
    ]);
  });

  it('bills a cut-off answer before refusing it', async () => {
    stub = stubResponses(() => ({
      payload: { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [], usage: usageBlock(9_000, 1_000, 8_000) },
    }));
    const passes: ExtractionUsage[] = [];
    await assert.rejects(extractSiteBrand(CRAWL, { ...CONTEXT, onUsage: async (pass) => { passes.push(pass); } }, CONFIG), FatalError);
    assert.deepEqual(passes, [{ model: 'gpt-5-nano', inputTokens: 8_000, cachedInputTokens: 1_000, outputTokens: 8_000 }]);
  });

  it('lets a failing ledger write fail the pass, so the step is retried', async () => {
    stub = stubResponses(() => ({ payload: outputText(CONFIDENT, usageBlock(100, 0, 10)) }));
    const failing = { ...CONTEXT, onUsage: () => Promise.reject(new Error('ledger unavailable')) };
    await assert.rejects(extractSiteBrand(CRAWL, failing, CONFIG), /ledger unavailable/);
  });

  it('leaves a rate limit to the workflow to retry', async () => {
    stub = stubResponses(() => ({ status: 429, payload: {} }));
    await assert.rejects(extractSiteBrand(CRAWL, CONTEXT, CONFIG), isRetryable);
    assert.equal(stub.sent.length, 2, 'the provider fetch retries an idempotent request once');
  });

  for (const [label, payload] of [
    ['no output', { status: 'completed', output: [] }],
    ['output that is not JSON', { status: 'completed', output: [{ content: [{ type: 'output_text', text: '{not json' }] }] }],
    ['JSON that is not a brand kit', outputText({ summary: 'A bakery.' })],
  ] as const) {
    it(`treats ${label} as a failure a retry may clear`, async () => {
      stub = stubResponses(() => ({ payload }));
      await assert.rejects(extractSiteBrand(CRAWL, CONTEXT, CONFIG), isRetryable);
    });
  }
});
