/**
 * Parsing the "create organization" form into a blank-slate brand.
 *
 * Blank slate is the whole point: a new organization carries only its name and
 * a slug derived from it. It gets NO tokens, NO copy, NO business contact --
 * the theme resolver supplies neutral defaults when `brand_config.tokens` is
 * absent, so a new tenant looks like the platform's own neutral surface until
 * its owner brands it, never like Coffee Story or any other tenant. Industry
 * is left open (multi_location on so stores can be added; every other feature
 * off) so the same flow onboards a builder, a bakery, or a barbershop.
 *
 * Pure and asset-free so it is unit-tested and shared by the demo and the live
 * write.
 */
import { slugify } from '@platform/domain';

export type OrgDraft = {
  readonly slug: string;
  readonly name: string;
  /** brand_config JSONB: identity + feature flags only, no tokens/copy. */
  readonly brandConfig: {
    identity: { slug: string; name: string };
    features: Record<string, boolean>;
  };
};

const BLANK_FEATURES: Record<string, boolean> = {
  drops: false,
  catering: false,
  delivery: false,
  multi_location: true,
  sms: false,
  stored_value: false,
  referrals: false,
};

export function parseOrgDraft(input: { name?: string }): { ok: true; draft: OrgDraft } | { ok: false; error: string } {
  const name = (input.name ?? '').trim();
  if (!name) return { ok: false, error: 'Enter an organization name.' };
  if (name.length > 120) return { ok: false, error: 'That organization name is too long.' };
  const slug = slugify(name, 64);
  if (!slug) return { ok: false, error: 'That name has no letters or numbers to build a handle from.' };
  return {
    ok: true,
    draft: {
      slug,
      name,
      brandConfig: { identity: { slug, name }, features: { ...BLANK_FEATURES } },
    },
  };
}
