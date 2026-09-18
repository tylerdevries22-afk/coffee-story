import type { BrandResearchArtifact } from '../lib/factory-automation';
import { log } from '../lib/log';
import { PublicFetchError } from '../lib/public-fetch';
import { crawlSite, type CrawlOptions, type SiteCrawl } from '../lib/site-crawl/crawl-site';
import { SiteCrawlError } from '../lib/site-crawl/crawl-fetch';
import { isLowConfidence } from '../lib/site-crawl/extraction-parse';
import { brandResearchFromKit, buildSiteBrandKit, type SiteBrandKit } from '../lib/site-crawl/site-kit';
import type { FactoryRunRow } from './factory-runtime';
import { extractSiteBrand, type ExtractionConfig, type ExtractionUsageHook } from './site-extraction';

/**
 * Brand research from the business's own website, instead of hosted search.
 *
 * The crawl costs a fraction of a cent and reads the business's own words;
 * hosted search costs about a cent a run and reads whatever it finds. So a
 * run with a website reads the site first, and returns null -- sending the
 * run to the capped search path -- only when the site gives nothing to build
 * from: unreachable, closed by robots.txt, a social profile rather than a
 * site, a page rendered entirely by script, or a kit that fails the same
 * artifact check a search answer must pass.
 */
export type SiteBrandResearch = BrandResearchArtifact & { readonly site: SiteBrandKit };

/** Below this much text a site is a script shell, and the model would be guessing. */
const MIN_SITE_TEXT = 400;

function readableText(crawl: SiteCrawl): number {
  return crawl.pages.reduce((total, page) => total + page.text.length, 0);
}

/** `onUsage` is the demo runner's ledger hook (site-extraction.ts); the factory passes none. */
export async function researchFromWebsite(
  run: FactoryRunRow,
  config: ExtractionConfig,
  crawlOptions: CrawlOptions = {},
  onUsage?: ExtractionUsageHook,
): Promise<SiteBrandResearch | null> {
  if (!run.websiteUrl) return null;
  let crawl: SiteCrawl;
  try {
    crawl = await crawlSite(run.websiteUrl, crawlOptions);
  } catch (error) {
    if (!(error instanceof SiteCrawlError) && !(error instanceof PublicFetchError)) throw error;
    log.warn('factory.site_research_skipped', { runId: run.id, reason: error.code });
    return null;
  }
  if (readableText(crawl) < MIN_SITE_TEXT) {
    log.warn('factory.site_research_skipped', { runId: run.id, reason: 'too_little_text' });
    return null;
  }
  const outcome = await extractSiteBrand(crawl, { businessName: run.businessName, runId: run.id, onUsage }, config);
  const kit = buildSiteBrandKit(crawl, outcome.extraction, {
    model: outcome.model,
    confidence: outcome.extraction.confidence,
    escalated: outcome.escalated,
    lowConfidence: isLowConfidence(outcome.extraction),
  });
  const artifact = brandResearchFromKit(kit);
  if (artifact === null) {
    log.warn('factory.site_research_skipped', { runId: run.id, reason: 'invalid_artifact' });
    return null;
  }
  return { ...artifact, site: kit };
}
