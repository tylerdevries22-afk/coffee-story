/**
 * The demo factory's website reader: the `readKit` the runner calls for a
 * business whose listing names a website.
 *
 * Crawl the site (lib/site-crawl), read it with a model when one is
 * configured (workflows/site-extraction.ts), and keep its logo as the demo's
 * own image. Every answer the model provider bills is booked on the demo's
 * ledger as it arrives, before anything can go wrong with it. A site that
 * yields nothing -- unreachable, closed by robots.txt, a social profile, a
 * page rendered entirely by script -- returns null and the demo is built
 * from its listing; any other failure throws, which the runner treats the
 * same way.
 *
 * Bounded for the runner's job window: the crawl and the logo draw on
 * budgets of their own, the job's signal reaches the model call, and a
 * doubtful first answer is re-read by the stronger model only while there is
 * time left to wait for it.
 */
import {
  extractionConfig, extractSiteBrand, type ExtractionConfig, type ExtractionUsage,
} from '../../workflows/site-extraction';
import { collectBrandAssets } from '../brand-assets/collect-assets';
import type { DemoDb } from '../demo-site';
import { log } from '../log';
import { CrawlBudget, PublicFetchError } from '../public-fetch';
import { SiteCrawlError } from '../site-crawl/crawl-fetch';
import { crawlSite, type SiteCrawl } from '../site-crawl/crawl-site';
import type { SiteExtraction } from '../site-crawl/extraction-parse';
import { demoMediaSink } from './demo-media-sink';
import type { DemoKitReader } from './job-build';
import type { DemoCostLine, OpenAiSku } from './prices';
import { demoKitFrom, kitLogoUrl } from './site-kit-map';

const MIB = 1_048_576;

export const SITE_KIT_LIMITS = {
  crawl: { maxRequests: 20, maxBytes: 16 * MIB, deadlineMs: 20_000 },
  logo: { maxRequests: 4, maxBytes: 8 * MIB, deadlineMs: 10_000 },
  /** Less text than this is a script shell, and a model would be guessing. */
  minText: 400,
  /** A doubtful first answer is re-read only while the reading has used less than this. */
  escalateWithinMs: 45_000,
} as const;

export type SiteKitDeps = {
  readonly storage: Pick<DemoDb, 'storage'>;
  /** Null when no model is configured: the kit then comes from the crawl alone. */
  readonly extraction: ExtractionConfig | null;
  readonly now: () => number;
  /** Seams for tests; the real crawl, model and download otherwise. */
  readonly crawl?: typeof crawlSite;
  readonly extract?: typeof extractSiteBrand;
  readonly collect?: typeof collectBrandAssets;
};

/** A billed answer as ledger lines: one per kind of token it used. */
export function usageLines(pass: ExtractionUsage): DemoCostLine[] {
  const counts: readonly [OpenAiSku, number][] = [
    ['input_tokens', pass.inputTokens], ['cached_input_tokens', pass.cachedInputTokens], ['output_tokens', pass.outputTokens],
  ];
  return counts.filter(([, quantity]) => quantity > 0)
    .map(([sku, quantity]) => ({ provider: 'openai' as const, sku, model: pass.model, quantity }));
}

/** The extraction models when a key and a research model are set, else null: the crawl still reads the site. */
export function optionalExtractionConfig(env: Readonly<Record<string, string | undefined>> = process.env): ExtractionConfig | null {
  try {
    return extractionConfig(env);
  } catch {
    return null;
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new Error('The demo job ran out of time while reading its website.');
}

async function crawlOrNull(website: string, deps: SiteKitDeps): Promise<SiteCrawl | null> {
  try {
    return await (deps.crawl ?? crawlSite)(website, { budget: new CrawlBudget(SITE_KIT_LIMITS.crawl) });
  } catch (error) {
    if (error instanceof SiteCrawlError || error instanceof PublicFetchError) return null;
    throw error;
  }
}

function readableText(crawl: SiteCrawl): number {
  return crawl.pages.reduce((total, page) => total + page.text.length, 0);
}

export function siteKitReader(deps: SiteKitDeps): DemoKitReader {
  return async ({ website, businessName, siteId, book, signal }) => {
    const started = deps.now();
    const crawl = await crawlOrNull(website, deps);
    if (crawl === null) return null;
    throwIfAborted(signal);

    let extraction: SiteExtraction | null = null;
    if (deps.extraction && readableText(crawl) >= SITE_KIT_LIMITS.minText) {
      try {
        const outcome = await (deps.extract ?? extractSiteBrand)(crawl, {
          businessName,
          runId: `demo-${siteId}`,
          signal,
          onUsage: async (pass) => { for (const line of usageLines(pass)) await book(line); },
          mayEscalate: () => deps.now() - started < SITE_KIT_LIMITS.escalateWithinMs,
        }, deps.extraction);
        extraction = outcome.extraction;
      } catch (error) {
        throwIfAborted(signal);
        // A reading that failed costs the demo its menu, not its colors, logo
        // or the address the outreach draft is written to.
        log.warn('demo_factory.extraction_failed', { siteId }, error);
      }
    }

    const logoUrl = kitLogoUrl(crawl, extraction);
    let logo: string | null = null;
    if (logoUrl !== null) {
      const sink = demoMediaSink(deps.storage, siteId);
      const manifest = await (deps.collect ?? collectBrandAssets)({ logoUrl, imageUrls: [] }, {
        sink, budget: new CrawlBudget(SITE_KIT_LIMITS.logo), maxPhotos: 0,
      });
      logo = manifest.logo && 'key' in manifest.logo ? manifest.logo.key : null;
    }
    return demoKitFrom(crawl, extraction, logo);
  };
}
