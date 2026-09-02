/**
 * The gate between an industry blueprint on disk and onboarding in memory.
 *
 * Blueprints are author-edited data, so they get the same trust posture as
 * module manifests: every field is validated before a blueprint may seed a
 * tenant, and the parser collects *every* problem rather than failing on the
 * first -- a blueprint review should end with the whole list, not a round
 * trip per mistake.
 *
 * A blueprint recommends module bundles and labels the shared domain nouns;
 * it never hard-codes UI behavior, so this contract stays pure data. Unknown
 * fields (such as a `$docs` block) are tolerated, matching the manifest
 * parser's strictness: only the fields the contract owns are validated.
 */

const KEY = /^[a-z][a-z0-9-]{1,48}[a-z0-9]$/;
const MODULE_KEY = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const REQUIRED_VOCABULARY = ['catalog', 'folder', 'offering', 'resource'] as const;

/**
 * What an industry publishes about itself. Every field is already known
 * well-formed by the time onboarding reads it, because the parser rejects any
 * blueprint that fails validation.
 */
export type IndustryBlueprint = {
  readonly schemaVersion: number;
  /** Stable across versions; slug-shaped, e.g. `coffee-shop`. */
  readonly key: string;
  readonly name: string;
  /** Bumped when the industry's template content changes. */
  readonly templateVersion: number;
  readonly locale: string;
  readonly supabaseRegion: string;
  /** Labels for the shared domain nouns; extra labels are allowed. */
  readonly vocabulary: Readonly<Record<string, string>>;
  /**
   * Module keys a tenant of this industry is seeded with at onboarding.
   * Recommendations only; the always-on core is implicit and never listed.
   */
  readonly recommendedModules: readonly string[];
};

export type BlueprintResult =
  | { readonly kind: 'ok'; readonly blueprint: IndustryBlueprint }
  | { readonly kind: 'invalid'; readonly issues: readonly string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseVocabulary(value: unknown, issues: string[]): Record<string, string> {
  if (!isRecord(value)) {
    issues.push('vocabulary must be an object of label strings');
    return {};
  }
  const out: Record<string, string> = {};
  for (const [label, text] of Object.entries(value)) {
    if (typeof text !== 'string' || text.length === 0) {
      issues.push(`vocabulary label "${label}" must be a non-empty string`);
      continue;
    }
    out[label] = text;
  }
  for (const required of REQUIRED_VOCABULARY) {
    if (!(required in out)) issues.push(`vocabulary must label "${required}"`);
  }
  return out;
}

function parseRecommendedModules(value: unknown, issues: string[]): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || entry.length === 0)) {
    issues.push('recommendedModules must be a list of module keys');
    return [];
  }
  const list = value as string[];
  if (list.length > 64) issues.push('recommendedModules may name at most 64 modules');
  for (const entry of list) {
    if (!MODULE_KEY.test(entry)) issues.push(`recommendedModules entry "${entry}" is not a module key`);
  }
  if (new Set(list).size !== list.length) issues.push('recommendedModules must not repeat modules');
  return list;
}

/** Validates a raw blueprint. Never throws: bad input is a result, not a crash. */
export function parseIndustryBlueprint(raw: unknown): BlueprintResult {
  const issues: string[] = [];
  if (!isRecord(raw)) return { kind: 'invalid', issues: ['an industry blueprint must be an object'] };

  const schemaVersion = raw.schemaVersion;
  if (typeof schemaVersion !== 'number' || !Number.isInteger(schemaVersion) || schemaVersion < 1) {
    issues.push('schemaVersion must be an integer of at least 1');
  }
  const key = typeof raw.key === 'string' ? raw.key : '';
  if (!KEY.test(key)) issues.push('key must be a lowercase slug of 3-50 characters');

  const name = raw.name;
  if (typeof name !== 'string' || name.length === 0) issues.push('name must be a non-empty string');

  const templateVersion = raw.templateVersion;
  if (typeof templateVersion !== 'number' || !Number.isInteger(templateVersion) || templateVersion < 1) {
    issues.push('templateVersion must be an integer of at least 1');
  }
  const locale = raw.locale;
  if (typeof locale !== 'string' || locale.length === 0) issues.push('locale must be a non-empty string');
  const supabaseRegion = raw.supabaseRegion;
  if (typeof supabaseRegion !== 'string' || supabaseRegion.length === 0) {
    issues.push('supabaseRegion must be a non-empty string');
  }

  const vocabulary = parseVocabulary(raw.vocabulary, issues);
  const recommendedModules = parseRecommendedModules(raw.recommendedModules, issues);

  if (issues.length > 0) return { kind: 'invalid', issues };
  return {
    kind: 'ok',
    blueprint: {
      schemaVersion: schemaVersion as number,
      key,
      name: name as string,
      templateVersion: templateVersion as number,
      locale: locale as string,
      supabaseRegion: supabaseRegion as string,
      vocabulary,
      recommendedModules,
    },
  };
}
