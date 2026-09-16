import type { AppPreviewKey } from './app-previews';

/**
 * Surfaces a partner network hosts, read from the tenant's own config.
 *
 * A venue on a partner network already has a staff console and a guest app on
 * that network. Rebuilding either here would ship a worse copy that has to
 * track the original forever, so the wall frames the real thing instead.
 *
 * Which network, and where its surfaces live, comes from `network` in the
 * tenant's brand config -- never a table of slugs in this file. Two reasons,
 * and the first is a rule: a network name in app source is a hard-coded brand
 * string, which `pnpm audit:brand` fails (it caught exactly that in the first
 * draft of this module). The second is the requirement -- a venue joining the
 * network must work with no edit here, or "any property" quietly means "the
 * ones someone remembered to list".
 *
 * The kiosk is never partner-hosted. A lobby screen is drawn from one
 * property's own published page, so it is per-venue by nature; the tenant-config
 * parser rejects a network that claims it, and this module never reads it.
 */
export type PartnerSurfaceUrls = Readonly<Partial<Record<AppPreviewKey, string>>>;

export type PartnerNetwork = {
  readonly slug: string;
  readonly surfaces: PartnerSurfaceUrls;
  /** Origins the partner's own CSP admits as a framing ancestor. */
  readonly framedBy: readonly string[];
};

type NetworkConfig = {
  slug?: unknown;
  hostedSurfaces?: unknown;
  framedBy?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function networkOf(brandConfig: unknown): NetworkConfig | null {
  if (!isRecord(brandConfig)) return null;
  const network = brandConfig.network;
  return isRecord(network) ? network as NetworkConfig : null;
}

/** The network slug a tenant declares, if any. */
export function networkSlugOf(brandConfig: unknown): string | null {
  const slug = networkOf(brandConfig)?.slug;
  return typeof slug === 'string' && slug.length > 0 ? slug : null;
}

/**
 * The partner surfaces a tenant's network serves, or null when it serves none.
 *
 * A network with no `hostedSurfaces` is not a partner in this sense -- a
 * franchisor that simply groups brands hosts nothing, and its venues keep the
 * surfaces this repo builds.
 */
export function partnerNetworkOf(brandConfig: unknown): PartnerNetwork | null {
  const network = networkOf(brandConfig);
  const slug = networkSlugOf(brandConfig);
  if (!network || !slug || !isRecord(network.hostedSurfaces)) return null;
  const surfaces: Record<string, string> = {};
  for (const [surface, url] of Object.entries(network.hostedSurfaces)) {
    // `kiosk` is refused by the parser; refused again here so a config written
    // before that rule existed still cannot take a venue's lobby screen away.
    if (surface === 'kiosk') continue;
    if (typeof url === 'string' && url.startsWith('https://')) surfaces[surface] = url;
  }
  if (Object.keys(surfaces).length === 0) return null;
  const framedBy = Array.isArray(network.framedBy)
    ? network.framedBy.filter((entry): entry is string => typeof entry === 'string')
    : [];
  return { slug, surfaces: surfaces as PartnerSurfaceUrls, framedBy };
}

/** Matches one origin against a partner pattern, honouring a single `*` label. */
function admits(pattern: string, origin: string): boolean {
  if (pattern === origin) return true;
  if (!pattern.includes('*')) return false;
  const [scheme, host] = pattern.split('://');
  const [originScheme, originHost] = origin.split('://');
  if (!scheme || !host || scheme !== originScheme || !originHost) return false;
  const suffix = host.replace(/^\*/, '');
  return originHost.endsWith(suffix) && originHost.length > suffix.length;
}

/**
 * Whether the partner admits `origin` as a framing ancestor.
 *
 * False means the frame will paint blank whatever we do, because the browser
 * enforces the partner's policy and not ours. A console that knows this can say
 * so rather than showing an empty rectangle a viewer reads as a broken app.
 */
export function partnerAdmitsOrigin(partner: PartnerNetwork, origin: string): boolean {
  return partner.framedBy.some((pattern) => admits(pattern, origin));
}
