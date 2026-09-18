import { pipeline, type Readable, type Transform } from 'node:stream';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';

import type { CrawlBudget } from './budget';
import { PublicFetchError } from './errors';

/**
 * Reads a response body into memory without trusting anything it claims.
 *
 * Requests go out with `accept-encoding: identity`, but a server may compress
 * anyway, and a few kilobytes of gzip can inflate to gigabytes. So the cap is
 * counted on decoded bytes as they stream out of the decoder, and the stream
 * is torn down the moment a chunk crosses it -- the whole body is never
 * inflated first and measured after. Every chunk is also charged to the
 * site's crawl budget as it arrives.
 */
function decoderFor(encoding: string): Transform | null {
  if (encoding === 'gzip' || encoding === 'x-gzip') return createGunzip();
  if (encoding === 'deflate') return createInflate();
  if (encoding === 'br') return createBrotliDecompress();
  return null;
}

/** The decoded view of `body`, or `wrong_type` for a coding this does not speak. */
export function decodedBody(body: Readable, contentEncoding: string | undefined): Readable {
  const codings = (contentEncoding ?? '')
    .split(',')
    .map((coding) => coding.trim().toLowerCase())
    .filter((coding) => coding !== '' && coding !== 'identity');
  if (codings.length === 0) return body;
  // Stacked codings are legal and never needed by a real site; refusing them
  // keeps one decoder, and one cap, between the socket and memory.
  const decoder = codings.length === 1 && codings[0] !== undefined ? decoderFor(codings[0]) : null;
  if (decoder === null) {
    body.destroy();
    throw new PublicFetchError('wrong_type');
  }
  // `pipeline` carries a socket error into the decoder and tears both down
  // together; the error itself surfaces where the decoder is read.
  pipeline(body, decoder, () => undefined);
  return decoder;
}

function asBuffer(chunk: unknown): Buffer {
  if (Buffer.isBuffer(chunk)) return chunk;
  if (chunk instanceof Uint8Array) return Buffer.from(chunk);
  if (typeof chunk === 'string') return Buffer.from(chunk, 'utf8');
  throw new PublicFetchError('network');
}

/**
 * Every decoded byte of `body`, or `too_large` as soon as there would be
 * more than `maxBytes` of them. Transport failures part-way through become
 * `network`; typed failures (a timeout, an overdrawn budget) pass through.
 */
export async function readBoundedBody(
  body: Readable,
  contentEncoding: string | undefined,
  maxBytes: number,
  budget: CrawlBudget,
): Promise<Buffer> {
  const decoded = decodedBody(body, contentEncoding);
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for await (const chunk of decoded) {
      const bytes = asBuffer(chunk);
      total += bytes.length;
      if (total > maxBytes) throw new PublicFetchError('too_large');
      budget.takeBytes(bytes.length);
      chunks.push(bytes);
    }
  } catch (error) {
    decoded.destroy();
    body.destroy();
    if (error instanceof PublicFetchError) throw error;
    throw new PublicFetchError('network', { cause: error });
  }
  return Buffer.concat(chunks, total);
}
