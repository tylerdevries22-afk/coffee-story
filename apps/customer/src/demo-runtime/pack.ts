/**
 * The demo pack a runtime-mode boot module fetched from /d/pack.json and
 * stashed on globalThis before requiring expo-router/entry (see index.js).
 * Every @tenant-bundle/* module the demo runtime resolver hands back reads
 * it from here instead of redeclaring the global -- see
 * scripts/lib/tenant-bundle-resolver.js's demoRuntimeBundlePath.
 */
export type DemoPack = {
  readonly brand?: unknown;
  readonly menu?: unknown;
  readonly modules?: unknown;
  readonly media?: {
    readonly logo?: string | null;
    readonly items?: Readonly<Record<string, string>>;
  };
};

declare global {
  // eslint-disable-next-line no-var -- the boot module's own handoff, not app state.
  var __PLATFORM_DEMO_PACK__: DemoPack | undefined;
}

/**
 * Never undefined by the time a tenant consumer reads it: index.js only
 * requires expo-router/entry -- which eventually requires this file --
 * after the fetch that sets this global has already resolved, and renders
 * its own "demo isn't available" message on any other outcome instead. An
 * empty object here means that guarantee broke, not a case to design for.
 */
export function demoPack(): DemoPack {
  return globalThis.__PLATFORM_DEMO_PACK__ ?? {};
}

/**
 * Item id -> its photo. GET /d/pack.json already rewrote each name to its
 * full /d/media/ proxy path, so this only has to wrap it in the shape a
 * runtime image source needs. An item the pack never photographed is simply
 * absent, the same as a tenant menu missing an entry in its generated map.
 */
export function menuMediaOf(pack: DemoPack): Readonly<Record<string, { readonly uri: string }>> {
  return Object.fromEntries(Object.entries(pack.media?.items ?? {}).map(([itemId, uri]) => [itemId, { uri }]));
}

/** The pack's own logo when it has one, a bundled fallback source otherwise. */
export function logoSourceOf<Fallback>(pack: DemoPack, fallback: Fallback): { readonly uri: string } | Fallback {
  const logo = pack.media?.logo;
  return logo ? { uri: logo } : fallback;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/**
 * The slug this runtime slot reports, read off the pack's own brand rather
 * than an env var -- there is no applied tenant to select in demo runtime
 * mode, only whichever business's pack the boot module fetched (see
 * ../tenants/selected.ts). Falls back to a reserved slug rather than letting
 * an unvalidated string reach a slot key; in practice this never fires,
 * because GET /d/pack.json already re-validated brand.identity.slug with
 * parseTenantManifest before the boot module ever saw it.
 */
export function runtimeSlug(brand: unknown, isValidSlug: (value: string) => boolean): string {
  const slug = record(record(brand).identity).slug;
  return typeof slug === 'string' && isValidSlug(slug) ? slug : 'demo';
}

/**
 * What the mandatory banner says (see index.js's boot module). Naming the
 * business twice reads a little repetitive on purpose: the second sentence
 * has to stand alone as the disclaimer, since a screen reader or a skim
 * cannot rely on the first sentence's antecedent.
 */
export function bannerText(businessName: string, builderName: string): string {
  return `Unofficial demo. ${builderName} built this to show what an ordering app for ${businessName} `
    + `could look like. ${businessName} has not endorsed or reviewed it.`;
}
