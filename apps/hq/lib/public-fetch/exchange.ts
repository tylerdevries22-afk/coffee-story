import type { Readable } from 'node:stream';

import type { CrawlBudget } from './budget';
import { PublicFetchError } from './errors';
import type { Transport, TransportResponse } from './https-transport';
import { KIND_POLICIES, parseContentType, sniffImageFormat, type PublicFetchKind } from './kinds';
import { readBoundedBody } from './read-body';
import { PUBLIC_FETCH_USER_AGENT } from './user-agent';

/**
 * One hop of a public fetch: a request, its time limits, and -- when it is
 * not a redirect -- the checks that decide whether its body is read at all.
 *
 * Status, media type and declared length are all judged from the headers,
 * before a byte of body is accepted; the body is then read under the kind's
 * cap and the site's budget, and an image must prove its format by its bytes.
 */
export type RequestTimeouts = {
  /** Until response headers arrive: DNS, TCP, TLS and the server's think time. */
  readonly connectMs: number;
  /** The whole exchange, body included. */
  readonly totalMs: number;
};

/**
 * Generous for shared small-business hosting, and short enough that a stuck
 * site costs one slot rather than the crawl.
 */
export const DEFAULT_TIMEOUTS: RequestTimeouts = { connectMs: 8_000, totalMs: 20_000 };

const RETRY_DELAY_MS = 300;
const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);

export type ExchangeResult = {
  /** Where the body actually came from, after redirects. */
  readonly url: URL;
  readonly status: number;
  /** For images, the format the bytes are, not the one the server claimed. */
  readonly mediaType: string;
  readonly charset: string | null;
  readonly body: Buffer;
};

export type Outcome =
  | { readonly kind: 'redirect'; readonly status: number; readonly location: string | undefined }
  | { readonly kind: 'done'; readonly result: ExchangeResult };

export type Exchange = {
  readonly transport: Transport;
  readonly timeouts: RequestTimeouts;
  readonly budget: CrawlBudget;
  readonly kind: PublicFetchKind;
};

export function requestHeaders(kind: PublicFetchKind): Record<string, string> {
  return {
    'user-agent': PUBLIC_FETCH_USER_AGENT,
    accept: KIND_POLICIES[kind].accept,
    // Identity keeps a declared length honest. A server that compresses
    // anyway is decoded under the same cap (read-body.ts).
    'accept-encoding': 'identity',
  };
}

function declaredLength(header: string | undefined): number | null {
  if (header === undefined || !/^\d+$/.test(header.trim())) return null;
  return Number(header.trim());
}

async function interpret(url: URL, response: TransportResponse, exchange: Exchange): Promise<Outcome> {
  const { status, headers, body } = response;
  if (REDIRECT_STATUSES.has(status)) {
    body.destroy();
    return { kind: 'redirect', status, location: headers.location };
  }
  if (status < 200 || status > 299) {
    body.destroy();
    throw new PublicFetchError('http_status', { status });
  }
  const policy = KIND_POLICIES[exchange.kind];
  const type = parseContentType(headers['content-type']);
  if (type === null || !policy.mediaTypes.includes(type.mediaType)) {
    body.destroy();
    throw new PublicFetchError('wrong_type');
  }
  const declared = declaredLength(headers['content-length']);
  if (declared !== null && declared > policy.maxBytes) {
    body.destroy();
    throw new PublicFetchError('too_large');
  }
  const bytes = await readBoundedBody(body, headers['content-encoding'], policy.maxBytes, exchange.budget);
  if (exchange.kind !== 'image') {
    return { kind: 'done', result: { url, status, mediaType: type.mediaType, charset: type.charset, body: bytes } };
  }
  const format = sniffImageFormat(bytes);
  if (format === null) throw new PublicFetchError('wrong_type');
  return { kind: 'done', result: { url, status, mediaType: `image/${format}`, charset: null, body: bytes } };
}

/** The transport's answer, or a rejection the moment `signal` fires. */
function untilAborted(pending: Promise<TransportResponse>, signal: AbortSignal): Promise<TransportResponse> {
  return new Promise((resolve, reject) => {
    const abort = (): void => reject(signal.reason);
    if (signal.aborted) abort();
    signal.addEventListener('abort', abort, { once: true });
    pending.then(
      (response) => {
        signal.removeEventListener('abort', abort);
        // An answer that lands after the deadline is still an open socket.
        if (signal.aborted) response.body.destroy();
        resolve(response);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', abort);
        reject(error);
      },
    );
  });
}

/** One request and, when it is the final hop, its whole body. */
export async function exchangeOnce(url: URL, exchange: Exchange): Promise<Outcome> {
  exchange.budget.takeRequest();
  const totalMs = Math.max(1, Math.min(exchange.timeouts.totalMs, exchange.budget.remainingMs()));
  const controller = new AbortController();
  const expire = (): void => controller.abort(new PublicFetchError('timeout'));
  const totalTimer = setTimeout(expire, totalMs);
  const connectTimer = setTimeout(expire, Math.min(exchange.timeouts.connectMs, totalMs));
  let body: Readable | undefined;
  const stopBody = (): void => {
    body?.destroy(new PublicFetchError('timeout'));
  };
  controller.signal.addEventListener('abort', stopBody, { once: true });
  try {
    const pending = exchange.transport({ url, headers: requestHeaders(exchange.kind), signal: controller.signal });
    const response = await untilAborted(pending, controller.signal);
    clearTimeout(connectTimer);
    body = response.body;
    return await interpret(url, response, exchange);
  } catch (error) {
    body?.destroy();
    if (controller.signal.aborted) throw new PublicFetchError('timeout', { cause: error });
    if (error instanceof PublicFetchError) throw error;
    throw new PublicFetchError('network', { cause: error });
  } finally {
    clearTimeout(totalTimer);
    clearTimeout(connectTimer);
    controller.signal.removeEventListener('abort', stopBody);
  }
}

/** One retry, and only for failures a second attempt could clear. */
export async function exchangeWithRetry(url: URL, exchange: Exchange): Promise<Outcome> {
  try {
    return await exchangeOnce(url, exchange);
  } catch (error) {
    if (!(error instanceof PublicFetchError) || !error.transient) throw error;
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    return exchangeOnce(url, exchange);
  }
}
