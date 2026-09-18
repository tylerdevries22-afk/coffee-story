import { PublicFetchError } from './errors';

/**
 * One site's whole allowance: requests, decoded bytes and wall-clock.
 *
 * Per-response caps bound a single file; they do not bound a site that
 * answers every page with a redirect, or serves eight maximum-size pages and
 * twelve maximum-size images. At a hundred demos a day the crawl must cost
 * the same order of magnitude for every business, so every request and every
 * byte -- redirect hops and retries included -- draws from one budget, and the
 * fetch that would overdraw it fails as `budget_exhausted`.
 */
export type CrawlBudgetLimits = {
  readonly maxRequests: number;
  readonly maxBytes: number;
  readonly deadlineMs: number;
};

/**
 * A full crawl is about 25 requests: robots.txt, up to 8 pages, up to 3
 * stylesheets, a logo and up to 12 images. The rest is headroom for redirects
 * and one retry each. 40 MB admits a normal site in full and stops a site of
 * maximum-size images well before every cap is reached at once.
 */
export const DEFAULT_CRAWL_LIMITS: CrawlBudgetLimits = {
  maxRequests: 40,
  maxBytes: 40 * 1_048_576,
  deadlineMs: 60_000,
};

export type CrawlBudgetUsage = {
  readonly requests: number;
  readonly bytes: number;
  readonly elapsedMs: number;
};

export class CrawlBudget {
  private requests = 0;
  private bytes = 0;
  private readonly startedAt: number;

  constructor(
    readonly limits: CrawlBudgetLimits = DEFAULT_CRAWL_LIMITS,
    private readonly now: () => number = Date.now,
  ) {
    this.startedAt = now();
  }

  /** Milliseconds left before the deadline, never negative. */
  remainingMs(): number {
    return Math.max(0, this.startedAt + this.limits.deadlineMs - this.now());
  }

  /** Spends one request, or refuses when requests or time are gone. */
  takeRequest(): void {
    if (this.requests >= this.limits.maxRequests || this.remainingMs() <= 0) {
      throw new PublicFetchError('budget_exhausted');
    }
    this.requests += 1;
  }

  /** Records bytes as they arrive, and refuses the chunk that overdraws. */
  takeBytes(count: number): void {
    if (this.bytes + count > this.limits.maxBytes) {
      this.bytes = this.limits.maxBytes;
      throw new PublicFetchError('budget_exhausted');
    }
    this.bytes += count;
  }

  usage(): CrawlBudgetUsage {
    return { requests: this.requests, bytes: this.bytes, elapsedMs: this.now() - this.startedAt };
  }
}
