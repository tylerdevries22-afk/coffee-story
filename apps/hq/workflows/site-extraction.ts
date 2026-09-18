// FatalError from its defining package: under tsx's CommonJS loader the
// `workflow` entry resolves to a plugin that exports none (see factory-research.ts).
import { FatalError } from '@workflow/errors';

import type { SiteCrawl } from '../lib/site-crawl/crawl-site';
import { isLowConfidence, parseExtraction, type SiteExtraction } from '../lib/site-crawl/extraction-parse';
import { providerFetch } from './factory-runtime';
import { extractionRequestBody } from './site-extraction-request';

/**
 * Reads a crawled site into a brand kit with the cheapest model that can,
 * and pays for a stronger one only when the answer is doubtful.
 *
 * Most small-business sites are simple enough for a nano-class model; the
 * research model re-reads a site only when the first answer is low
 * confidence (extraction-parse.ts decides). Configuration errors, requests
 * the provider rejects as malformed, and answers cut off by the output cap
 * are fatal: each would fail identically, and at full price, on a retry.
 */
type ResponsesPayload = {
  status?: string;
  incomplete_details?: { reason?: string } | null;
  output?: { content?: { type?: string; text?: string }[] }[];
};

export type ExtractionConfig = {
  readonly apiKey: string;
  /** OPENAI_RESEARCH_MODEL: the search path's model, and the escalation target. */
  readonly researchModel: string;
  /** The first, cheap pass: OPENAI_EXTRACTION_MODEL, or the research model when unset. */
  readonly model: string;
  /** The re-read on low confidence, or null when it would be the same model. */
  readonly escalationModel: string | null;
};

export type ExtractionOutcome = {
  readonly extraction: SiteExtraction;
  readonly model: string;
  readonly escalated: boolean;
};

type Environment = Readonly<Record<string, string | undefined>>;

/** The extraction models; a missing key or research model is fatal, never retried. */
export function extractionConfig(environment: Environment = process.env): ExtractionConfig {
  const apiKey = environment.OPENAI_API_KEY?.trim();
  const research = environment.OPENAI_RESEARCH_MODEL?.trim();
  if (!apiKey || !research) throw new FatalError('Research provider is not configured.');
  const model = environment.OPENAI_EXTRACTION_MODEL?.trim() || research;
  return { apiKey, researchModel: research, model, escalationModel: model === research ? null : research };
}

/** A 4xx other than timeout, conflict or rate limit is the request's fault and will not change. */
function rejectedForGood(status: number): boolean {
  return status >= 400 && status < 500 && status !== 408 && status !== 409 && status !== 429;
}

async function extractOnce(
  config: ExtractionConfig,
  model: string,
  crawl: SiteCrawl,
  context: { readonly businessName: string; readonly runId: string },
): Promise<SiteExtraction> {
  const response = await providerFetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': `platform-site-${context.runId}-${model}`,
    },
    body: JSON.stringify(extractionRequestBody(model, crawl, context.businessName)),
  });
  if (!response.ok) {
    const message = `Extraction provider rejected the request (${response.status}).`;
    throw rejectedForGood(response.status) ? new FatalError(message) : new Error(message);
  }
  const payload = await response.json() as ResponsesPayload;
  if (payload.status === 'incomplete') {
    throw new FatalError(`Extraction stopped early (${payload.incomplete_details?.reason ?? 'incomplete'}).`);
  }
  const text = payload.output?.flatMap((entry) => entry.content ?? [])
    .find((entry) => entry.type === 'output_text')?.text;
  if (!text) throw new Error('Extraction provider returned no brand kit.');
  let answer: unknown;
  try {
    answer = JSON.parse(text);
  } catch {
    throw new Error('Extraction provider returned malformed JSON.');
  }
  const extraction = parseExtraction(answer, crawl);
  if (extraction === null) throw new Error('Extraction provider returned an invalid brand kit.');
  return extraction;
}

/** One cheap pass, and a stronger second pass only when the first is doubtful. */
export async function extractSiteBrand(
  crawl: SiteCrawl,
  context: { readonly businessName: string; readonly runId: string },
  config: ExtractionConfig,
): Promise<ExtractionOutcome> {
  const first = await extractOnce(config, config.model, crawl, context);
  if (!isLowConfidence(first) || config.escalationModel === null) {
    return { extraction: first, model: config.model, escalated: false };
  }
  const second = await extractOnce(config, config.escalationModel, crawl, context);
  return { extraction: second, model: config.escalationModel, escalated: true };
}
