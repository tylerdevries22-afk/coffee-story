import type { SiteCrawl } from './crawl-site';
import type { PageTopic } from './page-selection';

/**
 * What the extraction model reads: the crawl's facts and page text, bounded.
 *
 * The model sees only what the site published, in a fixed order -- menu and
 * services pages first, because items are the hardest thing to recover and
 * the likeliest to be cut by the budget, then the homepage, about and
 * contact. Colours and logos are offered as numbered candidates so the model
 * chooses among what was found instead of describing what it imagines.
 */
const TOPIC_ORDER: readonly PageTopic[] = ['menu', 'services', 'home', 'about', 'contact', 'other'];
const TOPIC_LABEL: Readonly<Record<PageTopic, string>> = {
  menu: 'Menu page', services: 'Services page', home: 'Homepage', about: 'About page', contact: 'Contact page', other: 'Page',
};
const PAGE_CHARS = 20_000;
const CUT = '\n[cut for length]';

function header(crawl: SiteCrawl, businessName: string): string {
  const colors = crawl.colors.length === 0
    ? ['- (none found)']
    : crawl.colors.map((color) => `- ${color.hex} from ${color.names.join(', ')}${color.neutral ? ' (neutral)' : ''}`);
  const logos = crawl.logos.length === 0
    ? ['- (none found)']
    : crawl.logos.map((logo) => `- ${logo.url} (${logo.source})`);
  return [
    `Business name on its listing: ${businessName}`,
    `Website: ${crawl.home}`,
    `Site name: ${crawl.name ?? '(none)'}`,
    `Site description: ${crawl.description ?? '(none)'}`,
    '',
    'Candidate brand colours from the site theme and stylesheets, strongest first:',
    ...colors,
    '',
    'Logo candidates:',
    ...logos,
    '',
    'Pages:',
  ].join('\n');
}

/** The pages in reading order: what sells first, then what describes. */
export function orderedPages(crawl: SiteCrawl): SiteCrawl['pages'] {
  return [...crawl.pages].sort((a, b) => TOPIC_ORDER.indexOf(a.topic) - TOPIC_ORDER.indexOf(b.topic));
}

/** The whole prompt input, no longer than `maxChars`. */
export function extractionCorpus(crawl: SiteCrawl, businessName: string, maxChars: number): string {
  const parts = [header(crawl, businessName)];
  let remaining = maxChars - (parts[0]?.length ?? 0);
  for (const page of orderedPages(crawl)) {
    const heading = `\n\n## ${TOPIC_LABEL[page.topic]}: ${page.url}${page.title ? `\nTitle: ${page.title}` : ''}\n`;
    const room = Math.min(PAGE_CHARS, remaining - heading.length - CUT.length);
    if (room < 200) break;
    const text = page.text.length > room ? `${page.text.slice(0, room)}${CUT}` : page.text;
    parts.push(heading, text);
    remaining -= heading.length + text.length;
  }
  return parts.join('').slice(0, maxChars);
}

/**
 * Text normalised for "does the site actually say this": lowercase, accents
 * and punctuation folded, thousands separators removed, whitespace collapsed.
 */
export function groundingText(value: string): string {
  return value
    .replace(/(\d),(?=\d{3}(?:\D|$))/g, '$1')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[\p{Pi}\p{Pf}]/gu, "'")
    .replace(/[^\p{L}\p{N}$.' ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
