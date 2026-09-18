// The same class `workflow` re-exports, imported from its defining package:
// under a CommonJS loader (tsx, in tests) `workflow` resolves to its
// TypeScript plugin, which exports no FatalError at all.
import { FatalError } from '@workflow/errors';

import {
  parseBrandResearchArtifact,
  type BrandResearchArtifact,
} from '../lib/factory-automation';
import { providerFetch, type FactoryRunRow } from './factory-runtime';
import { reasoningFor, SEARCH_LIMITS } from './research-limits';

type ResponsesPayload = {
  status?: string;
  incomplete_details?: { reason?: string } | null;
  output?: { content?: { type?: string; text?: string }[] }[];
};

const RESEARCH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'logoSourceUrl', 'colors', 'sources'],
  properties: {
    summary: { type: 'string', minLength: 20, maxLength: 2000 },
    logoSourceUrl: { type: ['string', 'null'] },
    colors: {
      type: 'array', minItems: 2, maxItems: 8,
      items: { type: 'string', pattern: '^#[0-9A-Fa-f]{6}$' },
    },
    sources: {
      type: 'array', minItems: 1, maxItems: 12,
      items: {
        type: 'object', additionalProperties: false, required: ['title', 'url'],
        properties: { title: { type: 'string' }, url: { type: 'string' } },
      },
    },
  },
} as const;

function responseText(payload: ResponsesPayload): string | null {
  return payload.output?.flatMap((entry) => entry.content ?? [])
    .find((entry) => entry.type === 'output_text')?.text ?? null;
}

export async function researchBrand(run: FactoryRunRow): Promise<BrandResearchArtifact> {
  'use step';
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_RESEARCH_MODEL;
  // Fatal, not retried: a missing key is still missing on the next attempt.
  if (!apiKey || !model) throw new FatalError('Research provider is not configured.');
  const location = `${run.businessName}, location ${run.locationName}`;
  const response = await providerFetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': `platform-brand-${run.id}`,
    },
    body: JSON.stringify({
      model,
      tools: [{ type: 'web_search' }],
      max_tool_calls: SEARCH_LIMITS.brandResearch.maxToolCalls,
      max_output_tokens: SEARCH_LIMITS.brandResearch.maxOutputTokens,
      reasoning: reasoningFor(model),
      input: `Research the public brand identity for ${location}${run.websiteUrl ? `, official website ${run.websiteUrl}` : ''}. Use authoritative sources. Return a concise factual summary, two to eight observed or conservative accessible brand colors, an HTTPS official logo URL only when verified, and exact HTTPS sources. Do not invent a logo, credential, address, or legal claim.`,
      text: {
        format: {
          type: 'json_schema', name: 'platform_brand_research', strict: true,
          schema: RESEARCH_SCHEMA,
        },
      },
    }),
  });
  if (!response.ok) throw new Error(`Research provider rejected the request (${response.status}).`);
  const payload = await response.json() as ResponsesPayload;
  if (payload.status === 'incomplete') {
    // The output budget ran out mid-answer. A retry buys the same truncated
    // answer at the same price, so this stops the run instead.
    throw new FatalError(`Research stopped early (${payload.incomplete_details?.reason ?? 'incomplete'}).`);
  }
  const text = responseText(payload);
  const parsed = text ? parseBrandResearchArtifact(JSON.parse(text) as unknown) : null;
  if (!parsed) throw new Error('Research provider returned an invalid brand artifact.');
  return parsed;
}
