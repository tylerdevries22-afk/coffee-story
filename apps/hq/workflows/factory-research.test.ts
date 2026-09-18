import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { FatalError } from '@workflow/errors';

import { researchBrand } from './factory-research';
import type { FactoryRunRow } from './factory-runtime';
import { SEARCH_LIMITS } from './research-limits';

const RUN: FactoryRunRow = {
  id: 'run-1', businessName: 'Harbor Roast', tenantSlug: 'harbor-roast',
  industryKey: 'coffee-shop', locationName: 'Waterfront', supabaseRegion: 'us-west-1',
  surfaces: ['hq', 'customer'], websiteUrl: 'https://harbor.example',
};

const ARTIFACT = {
  summary: 'A waterfront coffee roaster serving espresso and pastries.',
  logoSourceUrl: null,
  colors: ['#1A2B3C', '#F0E0D0'],
  sources: [{ title: 'Harbor Roast', url: 'https://harbor.example' }],
};

type Sent = { model?: string; max_tool_calls?: number; max_output_tokens?: number; reasoning?: unknown };

const original = { fetch: globalThis.fetch, key: process.env.OPENAI_API_KEY, model: process.env.OPENAI_RESEARCH_MODEL };
let sent: Sent[] = [];

function respondWith(payload: unknown): void {
  globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body)) as Sent);
    return new Response(JSON.stringify(payload), { status: 200 });
  }) as typeof fetch;
}

const completed = { status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify(ARTIFACT) }] }] };

describe('brand research spending bounds', () => {
  beforeEach(() => {
    sent = [];
    process.env.OPENAI_API_KEY = 'test-key-not-real';
    process.env.OPENAI_RESEARCH_MODEL = 'gpt-5-mini';
  });
  afterEach(() => {
    globalThis.fetch = original.fetch;
    if (original.key === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = original.key;
    if (original.model === undefined) delete process.env.OPENAI_RESEARCH_MODEL;
    else process.env.OPENAI_RESEARCH_MODEL = original.model;
  });

  it('caps searches and output, and asks a reasoning model for low effort', async () => {
    respondWith(completed);
    const artifact = await researchBrand(RUN);
    assert.equal(artifact.summary, ARTIFACT.summary);
    assert.equal(sent.length, 1);
    assert.equal(sent[0]?.max_tool_calls, SEARCH_LIMITS.brandResearch.maxToolCalls);
    assert.equal(sent[0]?.max_output_tokens, SEARCH_LIMITS.brandResearch.maxOutputTokens);
    assert.deepEqual(sent[0]?.reasoning, { effort: 'low' });
  });

  it('sends no reasoning effort to a model that does not reason', async () => {
    // An effort on a non-reasoning model is a 400 on every call.
    process.env.OPENAI_RESEARCH_MODEL = 'gpt-4.1-mini';
    respondWith(completed);
    await researchBrand(RUN);
    assert.equal('reasoning' in (sent[0] ?? {}), false);
    assert.equal(sent[0]?.max_tool_calls, SEARCH_LIMITS.brandResearch.maxToolCalls);
  });

  it('stops for good when the output budget runs out, rather than paying again', async () => {
    respondWith({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [] });
    await assert.rejects(researchBrand(RUN),
      (error) => error instanceof FatalError && /max_output_tokens/.test(error.message));
  });

  it('does not retry a missing configuration', async () => {
    delete process.env.OPENAI_API_KEY;
    respondWith(completed);
    await assert.rejects(researchBrand(RUN), (error) => error instanceof FatalError);
    assert.equal(sent.length, 0, 'an unconfigured run must not reach the provider');
  });
});
