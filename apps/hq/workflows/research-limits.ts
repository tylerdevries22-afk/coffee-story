/**
 * Spending bounds for every hosted-search call the platform makes.
 *
 * OpenAI's web_search tool bills per search plus the search content it reads
 * into context, and no call here set a limit: how many searches a run made,
 * and how long it reasoned, was the model's decision. At the demo factory's
 * intended hundred businesses a day that is an open cost rather than an
 * estimate, so the bound goes in before anything runs at volume.
 *
 * `max_tool_calls` makes the provider ignore any search past the bound
 * instead of failing the request, so capping searches cannot break a run.
 * Output is capped only where the artifact is small and known -- a brand
 * research answer. A training curriculum can legitimately run to tens of
 * thousands of tokens, and cutting one short would fail the run, not save.
 */
export const SEARCH_LIMITS = {
  brandResearch: { maxToolCalls: 3, maxOutputTokens: 6_000 },
  trainingCurriculum: { maxToolCalls: 20 },
  trainingEvaluation: { maxToolCalls: 8 },
} as const;

/**
 * Reasoning effort for a research call, or nothing for a model that does not
 * reason.
 *
 * `low`, not `minimal`: the provider refuses web search on gpt-5 at minimal
 * effort. And the model comes from an environment variable, so the request
 * cannot assume it reasons -- sending an effort to one that does not is a 400
 * on every call.
 */
export function reasoningFor(model: string): { effort: 'low' } | undefined {
  return /^(gpt-5|o\d)/.test(model.trim()) ? { effort: 'low' } : undefined;
}
