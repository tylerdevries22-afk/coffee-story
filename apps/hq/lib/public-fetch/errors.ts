/**
 * Typed failures for reading a stranger's website.
 *
 * The crawl runs inside a workflow step that has to decide, per failure,
 * whether a second attempt could possibly help, and a prospect-facing report
 * has to say what went wrong without repeating anything the site sent. So the
 * code is a closed union and every message is a fixed sentence chosen here:
 * nothing from a response body or header is ever interpolated into one. The
 * HTTP status is the only value carried from the far side, and only as a
 * number.
 */
export type PublicFetchErrorCode =
  | 'invalid_url'
  | 'not_public'
  | 'redirect_limit'
  | 'too_large'
  | 'wrong_type'
  | 'timeout'
  | 'http_status'
  | 'budget_exhausted'
  | 'network';

const MESSAGES: Readonly<Record<PublicFetchErrorCode, string>> = {
  invalid_url: 'The address is not a standard public HTTPS URL.',
  not_public: 'The address points outside the public internet.',
  redirect_limit: 'The site redirected too many times.',
  too_large: 'The response was larger than this kind of file may be.',
  wrong_type: 'The response was not the kind of file that was asked for.',
  timeout: 'The site took too long to respond.',
  http_status: 'The site answered with an error status.',
  budget_exhausted: 'The crawl budget for this site is spent.',
  network: 'The site could not be reached.',
};

/**
 * Statuses a site returns when it is briefly unwell rather than when the
 * request itself is wrong. Anything else in the 4xx range will answer the
 * same way the second time.
 */
const TRANSIENT_STATUSES: ReadonlySet<number> = new Set([429, 502, 503, 504]);

type PublicFetchErrorOptions = {
  readonly status?: number | undefined;
  readonly cause?: unknown;
};

export class PublicFetchError extends Error {
  /** The HTTP status for `http_status`; never a header, never a body. */
  readonly status: number | undefined;

  constructor(readonly code: PublicFetchErrorCode, options: PublicFetchErrorOptions = {}) {
    const status = options.status;
    super(
      code === 'http_status' && status !== undefined
        ? `The site answered with HTTP ${status}.`
        : MESSAGES[code],
      { cause: options.cause },
    );
    this.name = 'PublicFetchError';
    this.status = status;
  }

  /**
   * True when retrying the same URL could plausibly succeed.
   *
   * A timeout is deliberately not transient here: it has already spent its
   * share of the crawl deadline, and a site that took that long once is the
   * likeliest to do it again.
   */
  get transient(): boolean {
    if (this.code === 'network') return true;
    return this.code === 'http_status' && this.status !== undefined && TRANSIENT_STATUSES.has(this.status);
  }
}

export function isPublicFetchError(error: unknown): error is PublicFetchError {
  return error instanceof PublicFetchError;
}
