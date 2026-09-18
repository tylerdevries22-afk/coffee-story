import { parseBrandResearchArtifact, type BrandResearchArtifact } from '../factory-automation';
import type { SiteCrawl } from './crawl-site';
import type { SiteExtraction, SiteItem } from './extraction-parse';
import type { PageTopic } from './page-selection';
import type { SocialLink } from './social-links';

/**
 * The brand kit a demo is built from, taken from the business's own site.
 *
 * Deterministic facts (contact emails, social profiles, candidate images,
 * the pages read) come straight from the crawl; the model contributes only
 * the summary, the palette, its choice among the logo candidates and the
 * items it could ground in the page text. Plain JSON throughout, because it
 * is saved as the run's brand_kit artifact.
 */
export type SiteBrandKit = {
  readonly website: string;
  readonly name: string | null;
  readonly summary: string;
  readonly colors: readonly string[];
  readonly logoUrl: string | null;
  readonly items: readonly SiteItem[];
  /** What the business publishes for enquiries, best first; see contact-emails.ts. */
  readonly contactEmails: readonly string[];
  readonly socialLinks: readonly SocialLink[];
  /** Candidate item and hero photographs, for the asset step to download. */
  readonly imageUrls: readonly string[];
  readonly pages: readonly { readonly url: string; readonly title: string | null; readonly topic: PageTopic }[];
  readonly extraction: {
    readonly model: string;
    readonly confidence: number;
    readonly escalated: boolean;
    readonly lowConfidence: boolean;
  };
};

export type ExtractionProvenance = SiteBrandKit['extraction'];

export function buildSiteBrandKit(crawl: SiteCrawl, extraction: SiteExtraction, provenance: ExtractionProvenance): SiteBrandKit {
  return {
    website: crawl.home,
    name: crawl.name,
    summary: extraction.summary,
    colors: extraction.colors,
    logoUrl: extraction.logoUrl,
    items: extraction.items,
    contactEmails: crawl.contactEmails,
    socialLinks: crawl.socialLinks,
    imageUrls: crawl.images.map((image) => image.url),
    pages: crawl.pages.map(({ url, title, topic }) => ({ url, title, topic })),
    extraction: provenance,
  };
}

const TOPIC_TITLE: Readonly<Record<PageTopic, string>> = {
  home: 'Homepage', menu: 'Menu', services: 'Services', about: 'About', contact: 'Contact', other: 'Page',
};

/**
 * The factory's existing research artifact, filled from the kit and checked
 * by the same parser that checks a search-based answer -- so both paths hand
 * the rest of the factory an identical shape, or nothing.
 */
export function brandResearchFromKit(kit: SiteBrandKit): BrandResearchArtifact | null {
  const sources = kit.pages.slice(0, 12).map((page) => ({
    title: page.title?.trim() || `${kit.name ?? new URL(kit.website).hostname} ${TOPIC_TITLE[page.topic]}`,
    url: page.url,
  }));
  return parseBrandResearchArtifact({
    summary: kit.summary,
    colors: kit.colors,
    sources,
    ...(kit.logoUrl ? { logoSourceUrl: kit.logoUrl } : {}),
  });
}
