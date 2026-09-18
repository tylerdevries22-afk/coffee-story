import assert from 'node:assert/strict';
import { describe, it, type TestContext } from 'node:test';

import type { ExtractionConfig, ExtractionContext } from '../../workflows/site-extraction';
import type { collectBrandAssets } from '../brand-assets/collect-assets';
import type { DemoDb } from '../demo-site';
import { SiteCrawlError } from '../site-crawl/crawl-fetch';
import type { DemoCostLine } from './prices';
import { optionalExtractionConfig, siteKitReader, usageLines, type SiteKitDeps } from './site-kit-reader';
import { crawlOf, extractionOf } from './site-kit.test-support';

const CONFIG: ExtractionConfig = { apiKey: 'test-only', researchModel: 'gpt-5-mini', model: 'gpt-5-nano', escalationModel: 'gpt-5-mini' };
const STORAGE = { storage: { from: () => ({ upload: async () => ({ data: {}, error: null }) }) } } as unknown as Pick<DemoDb, 'storage'>;
const STORED_LOGO = { sourceUrl: 'https://www.harborroast.example/logo.png', key: 'logo.webp', byteLength: 4, sha256: 'a'.repeat(64), edge: 512, flags: [] };

type Collect = typeof collectBrandAssets;

function harness(overrides: Partial<SiteKitDeps> = {}) {
  const seen = { contexts: [] as ExtractionContext[], collected: [] as unknown[], lines: [] as DemoCostLine[] };
  const collect: Collect = async (sources, options) => {
    seen.collected.push({ sources, maxPhotos: options.maxPhotos });
    await options.sink.put({ key: 'logo.webp', bytes: Buffer.from('webp'), contentType: 'image/webp', sha256: 'a'.repeat(64) });
    return { logo: STORED_LOGO, photos: [] };
  };
  const deps: SiteKitDeps = {
    storage: STORAGE, extraction: CONFIG, now: () => 0,
    crawl: async () => crawlOf(),
    extract: async (_crawl, context) => {
      seen.contexts.push(context);
      await context.onUsage?.({ model: 'gpt-5-nano', inputTokens: 12_000, cachedInputTokens: 0, outputTokens: 900 });
      return { extraction: extractionOf(), model: 'gpt-5-nano', escalated: false };
    },
    collect,
    ...overrides,
  };
  const controller = new AbortController();
  const read = () => siteKitReader(deps)({
    website: 'https://www.harborroast.example/', businessName: 'Harbor Roast', siteId: 'site-1', signal: controller.signal,
    book: async (line) => { seen.lines.push(line); },
  });
  return { seen, read, controller };
}

function quiet(t: TestContext): void {
  t.mock.method(console, 'warn', () => undefined);
}

describe('siteKitReader', () => {
  it('reads a website into a kit, booking what the model billed and keeping the logo as the demo’s own', async () => {
    const { seen, read, controller } = harness();
    const kit = await read();
    assert.equal(kit?.email, 'hello@harborroast.example');
    assert.equal(kit?.logo, 'logo.webp');
    assert.equal(kit?.menu.length, 3);
    assert.deepEqual(seen.lines, [
      { provider: 'openai', sku: 'input_tokens', model: 'gpt-5-nano', quantity: 12_000 },
      { provider: 'openai', sku: 'output_tokens', model: 'gpt-5-nano', quantity: 900 },
    ]);
    const [context] = seen.contexts;
    assert.equal(context?.runId, 'demo-site-1');
    assert.equal(context?.businessName, 'Harbor Roast');
    assert.equal(context?.signal, controller.signal, 'the job’s deadline reaches the model call');
    assert.deepEqual(seen.collected, [{ sources: { logoUrl: 'https://www.harborroast.example/logo.png', imageUrls: [] }, maxPhotos: 0 }]);
  });

  it('returns nothing, and spends nothing more, when the site gives nothing to build from', async () => {
    const { seen, read } = harness({ crawl: async () => { throw new SiteCrawlError('disallowed'); } });
    assert.equal(await read(), null);
    assert.deepEqual([seen.contexts.length, seen.collected.length, seen.lines.length], [0, 0, 0]);
  });

  it('lets a failure that is not about the site through', async () => {
    const { read } = harness({ crawl: async () => { throw new TypeError('bug'); } });
    await assert.rejects(read(), TypeError);
  });

  it('builds from the crawl alone when no model is configured, or the page is a script shell', async () => {
    for (const overrides of [{ extraction: null }, { crawl: async () => crawlOf({ pages: [] }) }] satisfies Partial<SiteKitDeps>[]) {
      const { seen, read } = harness(overrides);
      const kit = await read();
      assert.equal(seen.contexts.length, 0);
      assert.deepEqual(kit?.menu, []);
      assert.equal(kit?.email, 'hello@harborroast.example');
      assert.equal(kit?.logo, 'logo.webp');
    }
  });

  it('keeps the colors, logo and address when the model call fails', async (t) => {
    quiet(t);
    const { read } = harness({ extract: async () => { throw new Error('Provider returned 500.'); } });
    const kit = await read();
    assert.deepEqual(kit?.colors, ['#0b2545', '#1b998b']);
    assert.equal(kit?.email, 'hello@harborroast.example');
    assert.deepEqual(kit?.menu, []);
  });

  it('stops, rather than carry on, once the job is out of time', async () => {
    const { read, controller } = harness({
      extract: async () => { controller.abort(); throw new Error('aborted'); },
    });
    await assert.rejects(read(), /ran out of time/);
  });

  it('re-reads a doubtful answer only while the reading has time left', async () => {
    let clock = 0;
    const answers: boolean[] = [];
    const { read } = harness({
      now: () => clock,
      extract: async (_crawl, context) => {
        answers.push(context.mayEscalate?.() ?? true);
        clock = 50_000;
        answers.push(context.mayEscalate?.() ?? true);
        return { extraction: extractionOf(), model: 'gpt-5-nano', escalated: false };
      },
    });
    await read();
    assert.deepEqual(answers, [true, false]);
  });

  it('has no logo when the site offers none, or it would not download', async () => {
    const none = harness({ crawl: async () => crawlOf({ logos: [] }), extract: async () => ({ extraction: extractionOf({ logoUrl: null }), model: 'gpt-5-nano', escalated: false }) });
    assert.equal((await none.read())?.logo, null);
    assert.equal(none.seen.collected.length, 0);
    const failed = harness({ collect: async () => ({ logo: { sourceUrl: 'https://www.harborroast.example/logo.png', error: 'wrong_type' }, photos: [] }) });
    assert.equal((await failed.read())?.logo, null);
  });
});

describe('usageLines', () => {
  it('books each kind of token a pass used, and none it did not', () => {
    assert.deepEqual(usageLines({ model: 'gpt-5-mini', inputTokens: 900, cachedInputTokens: 100, outputTokens: 0 }), [
      { provider: 'openai', sku: 'input_tokens', model: 'gpt-5-mini', quantity: 900 },
      { provider: 'openai', sku: 'cached_input_tokens', model: 'gpt-5-mini', quantity: 100 },
    ]);
  });
});

describe('optionalExtractionConfig', () => {
  it('is null until a key and a research model are set', () => {
    assert.equal(optionalExtractionConfig({}), null);
    assert.equal(optionalExtractionConfig({ OPENAI_API_KEY: 'test-only' }), null);
    assert.equal(optionalExtractionConfig({ OPENAI_API_KEY: 'test-only', OPENAI_RESEARCH_MODEL: 'gpt-5-mini' })?.model, 'gpt-5-mini');
  });
});
