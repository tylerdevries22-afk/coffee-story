import type { SiteCrawl } from '../site-crawl/crawl-site';
import type { SiteExtraction } from '../site-crawl/extraction-parse';

/** A crawl of a small café's site, as lib/site-crawl would return it. */
export function crawlOf(overrides: Partial<SiteCrawl> = {}): SiteCrawl {
  return {
    home: 'https://www.harborroast.example/',
    host: 'harborroast.example',
    name: 'Harbor Roast',
    description: 'Waterfront coffee, roasted in Boulder.',
    pages: [{ url: 'https://www.harborroast.example/', topic: 'home', title: 'Harbor Roast', text: 'Coffee. '.repeat(80) }],
    colors: [
      { hex: '#F5F5F5', names: ['--background'], uses: 9, neutral: true },
      { hex: '#0B2545', names: ['--brand'], uses: 5, neutral: false },
      { hex: '#1B998B', names: ['--accent'], uses: 3, neutral: false },
    ],
    logos: [{ url: 'https://www.harborroast.example/logo.png', source: 'header-image' }],
    images: [],
    socialLinks: [],
    contactEmails: ['hello@harborroast.example', 'orders@harborroast.example'],
    skipped: [],
    ...overrides,
  };
}

/** A model's reading of that site, with three priced items. */
export function extractionOf(overrides: Partial<SiteExtraction> = {}): SiteExtraction {
  return {
    summary: 'Harbor Roast is a waterfront coffee shop in Boulder. It roasts its own beans.',
    colors: ['#0B2545', '#E4572E'],
    logoUrl: 'https://www.harborroast.example/logo.png',
    items: [
      { name: 'Latte', description: 'Steamed milk.', priceCents: 525, category: 'Coffee' },
      { name: 'Mocha', description: null, priceCents: 575, category: 'Coffee' },
      { name: 'Scone', description: null, priceCents: 350, category: 'Bakery' },
    ],
    confidence: 0.9,
    ungroundedItems: 0,
    ...overrides,
  };
}
