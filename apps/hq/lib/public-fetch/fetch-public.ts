import type { CrawlBudget } from './budget';
import { PublicFetchError } from './errors';
import {
  DEFAULT_TIMEOUTS, exchangeWithRetry, type Exchange, type ExchangeResult, type RequestTimeouts,
} from './exchange';
import { createHttpsTransport, type Transport } from './https-transport';
import type { PublicFetchKind } from './kinds';
import { parsePublicUrl } from './url-policy';

/**
 * Reads one file from a business's public website, safely.
 *
 * This is the body-reading sibling of public-resource-verifier.ts, which by
 * design never transfers a body. Every hop -- the first URL and each
 * redirect -- passes the URL policy again and connects through the pinned
 * lookup, so neither a redirect nor a DNS answer can steer the request
 * inward. The response must be the kind that was asked for, no larger than
 * that kind may be, inside its time limits and inside the site's shared
 * crawl budget.
 */
export const MAX_REDIRECTS = 3;

export type PublicFetchOptions = {
  /** The site's allowance. Every hop and retry draws on it. */
  readonly budget: CrawlBudget;
  /** Defaults to node:https through the pinned lookup; tests pass a fake. */
  readonly transport?: Transport | undefined;
  readonly timeouts?: Partial<RequestTimeouts> | undefined;
};

export type PublicFetchResult = ExchangeResult & {
  /** Redirects followed to reach `url`. */
  readonly redirects: number;
};

let sharedTransport: Transport | undefined;

/**
 * Fetches `target` as `kind`, following at most three redirects.
 *
 * Throws `PublicFetchError` for every refusal; its message never contains
 * anything the site sent.
 */
export async function fetchPublic(
  target: string | URL,
  kind: PublicFetchKind,
  options: PublicFetchOptions,
): Promise<PublicFetchResult> {
  const exchange: Exchange = {
    transport: options.transport ?? (sharedTransport ??= createHttpsTransport()),
    timeouts: {
      connectMs: options.timeouts?.connectMs ?? DEFAULT_TIMEOUTS.connectMs,
      totalMs: options.timeouts?.totalMs ?? DEFAULT_TIMEOUTS.totalMs,
    },
    budget: options.budget,
    kind,
  };
  let url = parsePublicUrl(target);
  for (let redirects = 0; ; redirects += 1) {
    const outcome = await exchangeWithRetry(url, exchange);
    if (outcome.kind === 'done') return { ...outcome.result, redirects };
    if (redirects === MAX_REDIRECTS) throw new PublicFetchError('redirect_limit');
    if (outcome.location === undefined) {
      throw new PublicFetchError('http_status', { status: outcome.status });
    }
    url = parsePublicUrl(outcome.location, url);
  }
}
