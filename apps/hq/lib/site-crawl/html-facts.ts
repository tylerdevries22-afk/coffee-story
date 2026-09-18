import { Parser } from 'htmlparser2';

import { elementHint, imageSource, pixelDimension, relTokens } from './html-attributes';

/**
 * Everything a crawl reads from one HTML page, in one streaming pass.
 *
 * A real parser, not patterns over markup: htmlparser2 decodes entities,
 * closes what authors leave open and keeps script and style bodies as raw
 * text, which is exactly where regular expressions over HTML go wrong. The
 * pass keeps only facts -- metadata, links, images, icons, stylesheets, inline
 * CSS, structured data and visible text -- each list capped, so a hostile or
 * enormous page costs a bounded amount of memory.
 */
export type LinkFact = { readonly href: string; readonly text: string; readonly inChrome: boolean };
export type ImageFact = {
  readonly src: string;
  readonly hint: string;
  readonly alt: string;
  readonly inChrome: boolean;
  readonly width: number | null;
  readonly height: number | null;
};
export type IconFact = { readonly href: string; readonly rel: string; readonly sizes: string | null };

export type PageFacts = {
  readonly title: string | null;
  /** First `content` per `name`/`property`, keys lowercased. */
  readonly meta: Readonly<Record<string, string>>;
  readonly links: readonly LinkFact[];
  readonly images: readonly ImageFact[];
  readonly icons: readonly IconFact[];
  readonly stylesheets: readonly string[];
  readonly inlineStyles: readonly string[];
  readonly jsonLd: readonly string[];
  /** Visible text, one block per line. */
  readonly text: string;
};

const LIMITS = { links: 400, images: 150, icons: 16, stylesheets: 16, styleChars: 200_000, jsonChars: 64_000, textChars: 200_000 };

/** Elements whose text a visitor never reads. */
const HIDDEN = new Set(['script', 'style', 'noscript', 'template', 'svg', 'math', 'iframe', 'object', 'canvas', 'textarea', 'select', 'title', 'head']);
/** Elements whose own title, images and links belong to something else. */
const FOREIGN = new Set(['svg', 'math', 'template', 'noscript']);
/** Site chrome: where a logo and the main navigation live. */
const CHROME = new Set(['header', 'nav']);
const BLOCKS = new Set([
  'address', 'article', 'aside', 'blockquote', 'br', 'dd', 'div', 'dl', 'dt', 'fieldset', 'figcaption', 'figure',
  'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre',
  'section', 'table', 'tr', 'ul',
]);
/** Table cells sit on one line, but a price column must not run into its name. */
const CELLS = new Set(['td', 'th']);

function cleanText(raw: string): string {
  return raw.replace(/\r/g, '').split('\n')
    .map((line) => line.replace(/[^\S\n]+/g, ' ').trim())
    .filter((line) => line !== '')
    .join('\n');
}

export function readPageFacts(html: string): PageFacts {
  const meta: Record<string, string> = {};
  const links: LinkFact[] = [];
  const images: ImageFact[] = [];
  const icons: IconFact[] = [];
  const stylesheets: string[] = [];
  const inlineStyles: string[] = [];
  const jsonLd: string[] = [];
  const text: string[] = [];
  let textLength = 0;
  let styleChars = 0;
  let jsonChars = 0;
  let title: string | null = null;
  let hidden = 0;
  let foreign = 0;
  let chrome = 0;
  let capture: { kind: 'title' | 'style' | 'json'; text: string } | null = null;
  let anchor: { href: string; text: string; inChrome: boolean } | null = null;

  const pushText = (value: string): void => {
    if (textLength >= LIMITS.textChars) return;
    text.push(value);
    textLength += value.length;
  };

  const open = (name: string, attributes: Record<string, string>): void => {
    if (BLOCKS.has(name)) pushText('\n');
    else if (CELLS.has(name)) pushText(' ');
    if (HIDDEN.has(name)) hidden += 1;
    if (FOREIGN.has(name)) foreign += 1;
    if (CHROME.has(name)) chrome += 1;
    if (foreign > 0) return;
    if (name === 'title' && title === null) capture = { kind: 'title', text: '' };
    else if (name === 'style') capture = { kind: 'style', text: '' };
    else if (name === 'script' && (attributes.type ?? '').toLowerCase().includes('ld+json')) capture = { kind: 'json', text: '' };
    else if (name === 'meta') {
      const key = (attributes.property ?? attributes.name ?? attributes.itemprop ?? '').toLowerCase();
      if (key !== '' && attributes.content !== undefined && meta[key] === undefined) meta[key] = attributes.content.trim();
    } else if (name === 'link' && attributes.href) {
      const rel = relTokens(attributes.rel);
      if (rel.includes('stylesheet') && !rel.includes('alternate') && stylesheets.length < LIMITS.stylesheets) stylesheets.push(attributes.href);
      if (rel.some((token) => token.includes('icon')) && icons.length < LIMITS.icons) {
        icons.push({ href: attributes.href, rel: rel.join(' '), sizes: attributes.sizes ?? null });
      }
    } else if (name === 'a' && attributes.href) {
      anchor = { href: attributes.href, text: '', inChrome: chrome > 0 };
    } else if (name === 'img' && images.length < LIMITS.images) {
      const src = imageSource(attributes);
      if (src !== null) {
        images.push({
          src, hint: elementHint(attributes, src), alt: (attributes.alt ?? '').trim(), inChrome: chrome > 0,
          width: pixelDimension(attributes.width), height: pixelDimension(attributes.height),
        });
      }
    }
  };

  const close = (name: string): void => {
    if (capture !== null && ((capture.kind === 'title' && name === 'title') || (capture.kind === 'style' && name === 'style')
      || (capture.kind === 'json' && name === 'script'))) {
      if (capture.kind === 'title') title = capture.text.replace(/\s+/g, ' ').trim() || null;
      else if (capture.kind === 'style' && styleChars < LIMITS.styleChars) {
        inlineStyles.push(capture.text);
        styleChars += capture.text.length;
      } else if (capture.kind === 'json' && jsonChars < LIMITS.jsonChars) {
        jsonLd.push(capture.text);
        jsonChars += capture.text.length;
      }
      capture = null;
    }
    if (name === 'a' && anchor !== null) {
      if (links.length < LIMITS.links) links.push({ ...anchor, text: anchor.text.replace(/\s+/g, ' ').trim() });
      anchor = null;
    }
    if (HIDDEN.has(name)) hidden = Math.max(0, hidden - 1);
    if (FOREIGN.has(name)) foreign = Math.max(0, foreign - 1);
    if (CHROME.has(name)) chrome = Math.max(0, chrome - 1);
    if (BLOCKS.has(name)) pushText('\n');
  };

  const parser = new Parser({
    onopentag: open,
    onclosetag: close,
    ontext: (data) => {
      if (capture !== null) capture.text += data;
      if (anchor !== null) anchor.text += data;
      // Line breaks in markup are just whitespace; only block boundaries end a line.
      if (hidden === 0) pushText(data.replace(/\s+/g, ' '));
    },
  }, { decodeEntities: true });
  parser.write(html);
  parser.end();

  return { title, meta, links, images, icons, stylesheets, inlineStyles, jsonLd, text: cleanText(text.join('')) };
}
