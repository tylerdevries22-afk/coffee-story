/**
 * The demo factory console's two forms, validated at the boundary.
 *
 * Both reach paid APIs or the brakes in front of them, so anything outside
 * the database's own bounds is refused here with a sentence, rather than
 * surfacing later as a constraint violation.
 */
export type DemoBatchInput = { readonly query: string; readonly count: number };

export type DemoLimitsInput = {
  readonly dailyLimit: number;
  readonly dailyBudgetMicrousd: number;
};

export type Parsed<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly message: string };

/** One IDs-only search page. The search is free; what it finds is what gets billed. */
export const DEMO_BATCH_MAX = 20;
export const DEMO_DAILY_LIMIT_MAX = 500;
export const DEMO_DAILY_BUDGET_MAX_DOLLARS = 1000;

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

function wholeNumber(value: unknown, min: number, max: number): number | null {
  const raw = text(value);
  if (!/^\d{1,4}$/.test(raw)) return null;
  const number = Number(raw);
  return number >= min && number <= max ? number : null;
}

export function parseDemoBatchInput(query: unknown, count: unknown): Parsed<DemoBatchInput> {
  const search = text(query);
  // Control characters have no place in a search, and angle brackets would
  // only ever arrive by accident; neither is worth sending to Google.
  if (search.length < 3 || search.length > 200 || /[<>\p{Cc}]/u.test(search)) {
    return { ok: false, message: 'Describe the businesses in 3 to 200 characters, e.g. "coffee shops in Boulder, CO".' };
  }
  const size = wholeNumber(count, 1, DEMO_BATCH_MAX);
  if (size === null) return { ok: false, message: `Build between 1 and ${DEMO_BATCH_MAX} demos at a time.` };
  return { ok: true, value: { query: search, count: size } };
}

/** `10`, `10.5` or `10.50` dollars, as micro-dollars, without a float in between. */
export function dollarsToMicrousd(value: unknown): number | null {
  const match = /^(\d{1,4})(?:\.(\d{1,2}))?$/.exec(text(value).replace(/^\$/, ''));
  if (!match) return null;
  const cents = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return cents * 10_000;
}

export function parseDemoLimitsInput(dailyLimit: unknown, dailyBudgetDollars: unknown): Parsed<DemoLimitsInput> {
  const limit = wholeNumber(dailyLimit, 0, DEMO_DAILY_LIMIT_MAX);
  if (limit === null) return { ok: false, message: `The daily count is a whole number from 0 to ${DEMO_DAILY_LIMIT_MAX}.` };
  const budget = dollarsToMicrousd(dailyBudgetDollars);
  if (budget === null || budget > DEMO_DAILY_BUDGET_MAX_DOLLARS * 1_000_000) {
    return { ok: false, message: `The daily budget is an amount from $0 to $${DEMO_DAILY_BUDGET_MAX_DOLLARS}.` };
  }
  return { ok: true, value: { dailyLimit: limit, dailyBudgetMicrousd: budget } };
}
