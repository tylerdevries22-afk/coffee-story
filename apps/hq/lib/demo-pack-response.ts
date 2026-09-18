/**
 * What GET /d/pack.json does with a cookie, apart from Next so it can be
 * tested the way demo-entry.ts is: a fake db and a fake builder stand in for
 * the network, and every branch -- no token, no config, an expired or
 * removed demo, a pack that fails demoPackExport's own validation -- is one
 * outcome the route maps to a status code.
 */
import type { DemoBuilder } from './demo-builder';
import { demoPackExport, type DemoPackExport } from './demo-pack-export';
import { viewDemoSite, type DemoDb } from './demo-site';
import { isDemoToken } from './demo-token';

export type DemoPackOutcome =
  | { readonly kind: 'ok'; readonly pack: DemoPackExport }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'unavailable' };

export async function demoPackResponse(token: string, deps: {
  readonly db: DemoDb | null;
  readonly builder: DemoBuilder | null;
}): Promise<DemoPackOutcome> {
  // Shape first, exactly like demo-entry.ts: a malformed cookie never costs a
  // database round trip.
  if (!isDemoToken(token)) return { kind: 'not_found' };
  // No database or no builder name means this deployment cannot serve any
  // demo at all right now -- not that this one is missing.
  if (!deps.db || !deps.builder) return { kind: 'unavailable' };
  const site = await viewDemoSite(deps.db, token);
  if (site.state !== 'ready') return { kind: 'not_found' };
  const pack = demoPackExport({
    pack: site.pack,
    businessName: site.businessName,
    token,
    builder: deps.builder,
    expiresAt: site.expiresAt,
  });
  return pack ? { kind: 'ok', pack } : { kind: 'not_found' };
}
