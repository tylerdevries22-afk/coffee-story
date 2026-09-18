/**
 * What each kind of fetch may bring back, and how much of it.
 *
 * The crawler asks for four things -- pages, stylesheets, images and
 * robots.txt -- and each gets its own ceiling and media-type allowlist, so a
 * page that turns out to be a 2 GB video, or a "logo" that is an HTML error
 * page, is refused at the headers instead of being read. The caps are applied
 * to decoded bytes (read-body.ts), which is what a zip bomb inflates.
 */
export type PublicFetchKind = 'html' | 'css' | 'image' | 'robots';

export type ImageFormat = 'png' | 'jpeg' | 'webp' | 'gif';

type KindPolicy = {
  /** Decoded bytes allowed for one response of this kind. */
  readonly maxBytes: number;
  /** Media types accepted, compared without parameters. */
  readonly mediaTypes: readonly string[];
  readonly accept: string;
};

const MIB = 1_048_576;

export const KIND_POLICIES: Readonly<Record<PublicFetchKind, KindPolicy>> = {
  // A heavy small-business homepage is a few hundred KB of markup; 1.5 MB
  // leaves room for inlined builder output without admitting a data dump.
  html: {
    maxBytes: 1.5 * MIB,
    mediaTypes: ['text/html', 'application/xhtml+xml'],
    accept: 'text/html,application/xhtml+xml;q=0.9',
  },
  css: { maxBytes: 0.5 * MIB, mediaTypes: ['text/css'], accept: 'text/css' },
  // SVG is refused on purpose. It is an XML document, not a picture: it can
  // carry script and entity expansion, and rasterising an untrusted one has
  // a history of reading local files through external references. A brand
  // whose only logo is SVG falls back to its raster touch icon or og:image.
  // `image/jpg` is not a registered type but is what many hosts send.
  image: {
    maxBytes: 8 * MIB,
    mediaTypes: ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'],
    accept: 'image/png,image/jpeg,image/webp,image/gif',
  },
  // RFC 9309 has crawlers read at least 500 KiB of robots.txt.
  robots: { maxBytes: 0.5 * MIB, mediaTypes: ['text/plain'], accept: 'text/plain' },
};

export type ContentType = { readonly mediaType: string; readonly charset: string | null };

/** `text/html; charset=UTF-8` as `{ mediaType: 'text/html', charset: 'utf-8' }`. */
export function parseContentType(header: string | undefined): ContentType | null {
  if (header === undefined) return null;
  const [type, ...parameters] = header.split(';');
  const mediaType = type?.trim().toLowerCase() ?? '';
  if (!/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(mediaType)) return null;
  let charset: string | null = null;
  for (const parameter of parameters) {
    const [name, value] = parameter.split('=');
    if (name?.trim().toLowerCase() === 'charset' && value) {
      charset = value.trim().replace(/^"|"$/g, '').toLowerCase() || null;
    }
  }
  return { mediaType, charset };
}

function startsWith(bytes: Uint8Array, offset: number, signature: readonly number[]): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

function ascii(text: string): number[] {
  return [...text].map((character) => character.charCodeAt(0));
}

/**
 * The image format the bytes actually are, whatever the server claimed.
 *
 * Image decoders pick a codec by content, not by header, so an SVG or TIFF
 * served as `image/png` would reach a decoder this module never meant to
 * expose. Only the four raster signatures are recognised.
 */
export function sniffImageFormat(bytes: Uint8Array): ImageFormat | null {
  if (startsWith(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (startsWith(bytes, 0, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (startsWith(bytes, 0, ascii('GIF87a')) || startsWith(bytes, 0, ascii('GIF89a'))) return 'gif';
  if (startsWith(bytes, 0, ascii('RIFF')) && startsWith(bytes, 8, ascii('WEBP'))) return 'webp';
  return null;
}
