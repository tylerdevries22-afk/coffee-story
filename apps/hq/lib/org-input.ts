/**
 * Parsing the "create organization" form into a blank-slate brand.
 *
 * Blank slate is the whole point: a new organization carries only its name and
 * a slug derived from it. It gets NO tokens, NO copy, NO business contact --
 * the theme resolver supplies neutral defaults when `brand_config.tokens` is
 * absent, so a new tenant looks like the platform's own neutral surface until
 * its owner brands it, never like Coffee Story or any other tenant. It also
 * gets NO capabilities: what an organization may run comes from
 * `module_installations`, installed deliberately per tenant, so the same flow
 * onboards a builder, a bakery, or a barbershop with nothing switched on that
 * nobody asked for.
 *
 * Pure and asset-free so it is unit-tested and shared by the demo and the live
 * write.
 */
import { slugify } from '@platform/domain';

export type OrgDraft = {
  readonly slug: string;
  readonly name: string;
  /** brand_config JSONB: identity only, no tokens, copy, or capability blob. */
  readonly brandConfig: {
    identity: { slug: string; name: string };
  };
};

export function parseOrgDraft(input: { name?: string }): { ok: true; draft: OrgDraft } | { ok: false; error: string } {
  const name = (input.name ?? '').trim();
  if (!name) return { ok: false, error: 'Enter an organization name.' };
  if (name.length > 120) return { ok: false, error: 'That organization name is too long.' };
  const slug = slugify(name, 63);
  if (!slug) return { ok: false, error: 'That name has no letters or numbers to build a handle from.' };
  if (slug.length < 2) return { ok: false, error: 'Enter at least two letters or numbers for the organization handle.' };
  return {
    ok: true,
    draft: {
      slug,
      name,
      brandConfig: { identity: { slug, name } },
    },
  };
}
