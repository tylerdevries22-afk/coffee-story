import type { AppPreviewKey } from './app-previews';

/**
 * Surfaces a partner network hosts itself, rather than this repo building them.
 *
 * Most tenants get five surfaces this repo compiles. A venue on a partner
 * network does not: its staff already work in the partner's own portal and its
 * guests already carry the partner's own app, so rebuilding either here would
 * produce a second, worse copy that has to be kept in step with the original
 * forever. The wall frames the real thing instead.
 *
 * Keyed on the tenant's NETWORK, never on a tenant slug. A network has one
 * portal and one guest app for every venue under it, so keying on the slug
 * would mean editing this file for every hotel that joins -- which is exactly
 * the "works for any property" requirement failing quietly.
 *
 * The kiosk is deliberately absent: a lobby screen is per-property, built from
 * that hotel's own published page, so it stays a surface this repo serves.
 */
export type PartnerSurfaceUrls = Readonly<Partial<Record<AppPreviewKey, string>>>;

/**
 * Whether a frame pointed at this partner can actually paint.
 *
 * Framing is the partner's decision, not ours: the browser enforces THEIR
 * `frame-ancestors`, so an origin they do not list renders blank no matter what
 * we put in the src. Recorded per network so the wall can say "this partner
 * does not admit this origin" instead of showing an empty rectangle and
 * letting a viewer conclude the app is broken.
 */
export type PartnerNetwork = {
  readonly surfaces: PartnerSurfaceUrls;
  /** Origins the partner's CSP admits as a framing ancestor. */
  readonly framedBy: readonly string[];
};

const ACTZ_ORIGIN = 'https://actz.org';

export const PARTNER_NETWORKS: Readonly<Record<string, PartnerNetwork>> = {
  actz: {
    surfaces: {
      // The provider portal: the venue's own staff console on the network.
      hq: `${ACTZ_ORIGIN}/dashboard`,
      // The traveller app a guest carries, which is also what the operator
      // surface shows -- staff look at the same itinerary the guest does.
      operator: `${ACTZ_ORIGIN}/profile-dashboard`,
    },
    // Mirrors actz-may's security-csp.ts: production admits 'self', *.vercel.app
    // and the actz.org origins, plus whatever EMBED_ALLOWED_ORIGINS carries.
    // A localhost HQ is NOT on that list, so the local wall cannot frame it
    // until that repo adds the origin and ships it.
    framedBy: ['https://*.vercel.app', 'https://actz.org', 'https://*.actz.org'],
  },
};

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

export function partnerNetworkFor(networkSlug: string | null | undefined): PartnerNetwork | null {
  if (!networkSlug) return null;
  return PARTNER_NETWORKS[networkSlug] ?? null;
}

/**
 * The network slug a tenant's brand config declares, if any.
 *
 * Read from the config rather than a list here, so a venue joining the network
 * is a tenant-folder fact and nothing in this repo changes.
 */
export function networkSlugOf(brandConfig: unknown): string | null {
  if (typeof brandConfig !== 'object' || brandConfig === null) return null;
  const network = (brandConfig as { network?: unknown }).network;
  if (typeof network !== 'object' || network === null) return null;
  const slug = (network as { slug?: unknown }).slug;
  return typeof slug === 'string' && slug.length > 0 ? slug : null;
}

/** Whether the partner admits `origin` as a framing ancestor. */
export function partnerAdmitsOrigin(partner: PartnerNetwork, origin: string): boolean {
  return partner.framedBy.some((pattern) => admits(pattern, origin));
}
