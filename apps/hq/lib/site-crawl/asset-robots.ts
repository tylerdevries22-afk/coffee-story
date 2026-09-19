import { PublicFetchError, type PublicFetchOptions } from '../public-fetch';
import { robotsRulesFor } from './crawl-fetch';
import { sameSite } from './page-selection';
import { robotsAllows, type RobotsRules } from './robots';

/**
 * robots.txt for the hosts a crawl's pictures come from.
 *
 * RFC 9309 scopes a robots.txt to the origin that serves it, so a logo on a
 * CDN is governed by the CDN's file, not the site's. Same-site pictures (www
 * and the bare domain are one site) use the rules the crawl already read.
 * Every other origin's file is read once, and only for the first
 * MAX_ASSET_ORIGINS origins in the order given -- logos first -- so a page
 * that scatters pictures across many hosts cannot spend the crawl budget on
 * robots.txt. A picture whose origin's file was not read, past the cap or
 * for want of budget, is not offered: unconfirmed is not permission.
 */
export type AssetPermission = (url: string) => boolean;

export const MAX_ASSET_ORIGINS = 4;

function httpsUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

export async function assetPermission(
  urls: Iterable<string>,
  home: URL,
  homeRules: RobotsRules,
  options: PublicFetchOptions,
): Promise<AssetPermission> {
  const origins: URL[] = [];
  for (const value of urls) {
    const url = httpsUrl(value);
    if (url === null || sameSite(url, home) || origins.some((seen) => seen.origin === url.origin)) continue;
    if (origins.length === MAX_ASSET_ORIGINS) break;
    origins.push(url);
  }
  const settled = await Promise.allSettled(origins.map((url) => robotsRulesFor(url, options)));
  const rules = new Map<string, RobotsRules>();
  settled.forEach((outcome, index) => {
    const origin = origins[index]?.origin;
    if (outcome.status === 'fulfilled') {
      if (origin !== undefined) rules.set(origin, outcome.value);
    } else if (!(outcome.reason instanceof PublicFetchError)) {
      // robotsRulesFor turns every fetch failure but a spent budget into
      // rules, so anything else reaching here is a bug, and a bug should be loud.
      throw outcome.reason;
    }
  });
  return (value) => {
    const url = httpsUrl(value);
    if (url === null) return false;
    const applicable = sameSite(url, home) ? homeRules : rules.get(url.origin);
    return applicable !== undefined && robotsAllows(applicable, url.pathname + url.search);
  };
}
