/**
 * The shape GET /d/pack.json answers with, checked before the boot module
 * trusts any of it. Kept apart from boot.ts, which starts the app as a side
 * effect of being loaded, so tests can import this with no document around.
 */
import type { DemoPack } from './pack';

export type PackResponse = DemoPack & {
  readonly businessName: string;
  readonly removeHref: string;
  readonly builder: { readonly name: string; readonly contactHref: string | null };
};

/**
 * One leading "/", never "//" or "/\": removeHref becomes an anchor href,
 * and a browser reads either of those as the start of another host.
 */
function isSameOriginPath(value: unknown): value is string {
  return typeof value === 'string' && /^\/(?![/\\])/.test(value);
}

export function isPackResponse(value: unknown): value is PackResponse {
  const source = value as Partial<PackResponse> | null;
  return typeof source === 'object' && source !== null
    && typeof source.businessName === 'string'
    && isSameOriginPath(source.removeHref)
    && typeof source.builder === 'object' && source.builder !== null
    && typeof source.builder.name === 'string';
}
