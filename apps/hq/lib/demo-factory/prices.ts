/**
 * What the demo factory pays for each billed call, in integer micro-dollars.
 *
 * A Place Details call is $0.020 and a gpt-5-nano input token is $0.00000005,
 * so whole cents can hold neither. Every call is priced here when it is made
 * and stored as an integer, which makes a business's cost an exact sum, and a
 * price change apply from that moment on without rewriting what was spent.
 *
 * These are list prices before any free monthly allowance: Google Maps
 * Platform pay-as-you-go at the 0-100k/month tier, and OpenAI's standard tier,
 * as checked on 2026-09-18. The first batch's invoice is the test of both.
 */
import { formatMoney } from '@platform/domain';

export type PlacesSku = 'text_search_ids' | 'place_details_enterprise' | 'place_details_atmosphere' | 'place_photo';
export type OpenAiSku = 'input_tokens' | 'cached_input_tokens' | 'output_tokens';

export type DemoCostLine =
  | { readonly provider: 'google_places'; readonly sku: PlacesSku; readonly quantity: number }
  | { readonly provider: 'openai'; readonly sku: OpenAiSku; readonly model: string; readonly quantity: number };

const PLACES: Readonly<Record<PlacesSku, number>> = {
  text_search_ids: 0,
  place_details_enterprise: 20_000,
  place_details_atmosphere: 25_000,
  place_photo: 7_000,
};

type TokenPrices = Readonly<Record<OpenAiSku, number>>;

/** Per million tokens. */
const GPT_5: TokenPrices = { input_tokens: 1_250_000, cached_input_tokens: 125_000, output_tokens: 10_000_000 };
const OPENAI: Readonly<Record<string, TokenPrices>> = {
  'gpt-5-nano': { input_tokens: 50_000, cached_input_tokens: 5_000, output_tokens: 400_000 },
  'gpt-5-mini': { input_tokens: 250_000, cached_input_tokens: 25_000, output_tokens: 2_000_000 },
  'gpt-5': GPT_5,
};
const MODELS_LONGEST_FIRST = Object.keys(OPENAI).sort((a, b) => b.length - a.length);

/**
 * Prices for a model as the API names it, dated snapshots included
 * (`gpt-5-mini-2025-08-07`). A model this table does not know is priced as
 * the dearest one it does, so an unfamiliar model can only make the budget
 * brake stop early, never late.
 */
export function openAiPrices(model: string): TokenPrices {
  const known = MODELS_LONGEST_FIRST.find((key) => model === key || model.startsWith(`${key}-`));
  return (known ? OPENAI[known] : undefined) ?? GPT_5;
}

function wholeQuantity(quantity: number): number {
  return Number.isFinite(quantity) && quantity > 0 ? Math.trunc(quantity) : 0;
}

/** What one line costs. Tokens round up, so a sum of lines never undercounts. */
export function lineCostMicrousd(line: DemoCostLine): number {
  const quantity = wholeQuantity(line.quantity);
  if (line.provider === 'google_places') return PLACES[line.sku] * quantity;
  return Math.ceil((quantity * openAiPrices(line.model)[line.sku]) / 1_000_000);
}

export type DemoEstimateAssumptions = {
  readonly photosPerBusiness: number;
  readonly extractionInputTokens: number;
  readonly extractionOutputTokens: number;
  /** The share of businesses whose first extraction is unsure enough to re-run on mini. */
  readonly escalationShare: number;
};

/** The assumptions the plan was costed on, stated so a reconciliation can correct them. */
export const DEMO_ESTIMATE_ASSUMPTIONS: DemoEstimateAssumptions = {
  photosPerBusiness: 0.8,
  extractionInputTokens: 15_000,
  extractionOutputTokens: 3_000,
  escalationShare: 0.3,
};

function extraction(model: string, assumptions: DemoEstimateAssumptions): number {
  return lineCostMicrousd({ provider: 'openai', sku: 'input_tokens', model, quantity: assumptions.extractionInputTokens })
    + lineCostMicrousd({ provider: 'openai', sku: 'output_tokens', model, quantity: assumptions.extractionOutputTokens });
}

/**
 * The expected API cost of one business: one Place Details call, some photos,
 * one nano extraction and a mini re-run for a share of them. Compute and
 * hosting are not metered per call and are not in it.
 */
export function estimateDemoMicrousd(assumptions: DemoEstimateAssumptions = DEMO_ESTIMATE_ASSUMPTIONS): number {
  return lineCostMicrousd({ provider: 'google_places', sku: 'place_details_enterprise', quantity: 1 })
    + Math.ceil(PLACES.place_photo * assumptions.photosPerBusiness)
    + extraction('gpt-5-nano', assumptions)
    + Math.ceil(extraction('gpt-5-mini', assumptions) * assumptions.escalationShare);
}

/** `$12.34` from a dollar up, four places below it, where a demo's cost lives. */
export function formatMicrousd(value: number): string {
  const micro = Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
  const tenThousandths = Math.round(micro / 100);
  if (tenThousandths >= 10_000) return formatMoney(Math.round(micro / 10_000));
  return `$0.${String(tenThousandths).padStart(4, '0')}`;
}
