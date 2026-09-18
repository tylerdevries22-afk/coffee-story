import assert from 'node:assert/strict';
import test from 'node:test';

import type { SiteCrawl } from './crawl-site';
import { extractionCorpus, groundingText, orderedPages } from './extraction-corpus';
import { WWW, bakeryCrawl } from './site-fixtures.test-support';

const COLORS: SiteCrawl['colors'] = [
  { hex: '#7A3E1D', names: ['theme-color', '--brand-primary'], uses: 2, neutral: false },
  { hex: '#E8A948', names: ['--brand-accent'], uses: 1, neutral: false },
  { hex: '#222222', names: ['--text'], uses: 1, neutral: true },
];
const NAME = 'Maple Row Bakehouse';

test('pages are read menu first, then the homepage, then about and contact', () => {
  assert.deepEqual(orderedPages(bakeryCrawl(COLORS)).map((page) => page.topic), ['menu', 'home', 'about', 'contact']);
});

test('the corpus lists the colours and logos found as candidates, then the pages', () => {
  const corpus = extractionCorpus(bakeryCrawl(COLORS), NAME, 60_000);
  for (const line of [
    'Business name on its listing: Maple Row Bakehouse',
    `Website: ${WWW}/`,
    '- #7A3E1D from theme-color, --brand-primary',
    '- #222222 from --text (neutral)',
    `- ${WWW}/images/maple-row-logo.png (json-ld)`,
    `## Menu page: ${WWW}/menu/\nTitle: Menu | Maple Row Bakehouse\n`,
  ]) {
    assert.ok(corpus.includes(line), line);
  }
  const order = ['## Menu page', '## Homepage', '## About page', '## Contact page'].map((heading) => corpus.indexOf(heading));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.ok(!order.includes(-1));
});

test('a crawl with nothing found says so rather than leaving the model a blank', () => {
  const corpus = extractionCorpus(bakeryCrawl([], { logos: [], name: null, description: null }), NAME, 60_000);
  assert.match(corpus, /Site name: \(none\)/);
  assert.match(corpus, /brand colours[^\n]*\n- \(none found\)/);
  assert.match(corpus, /Logo candidates:\n- \(none found\)/);
});

test('the corpus never exceeds its budget, and a long page is cut where the budget says', () => {
  const long = 'Country Sourdough $9.00. '.repeat(1_200);
  const crawl = bakeryCrawl(COLORS, {
    pages: [
      { url: `${WWW}/`, topic: 'home', title: null, text: 'Fresh bread and pastry since 2014.' },
      { url: `${WWW}/menu/`, topic: 'menu', title: null, text: long },
    ],
  });
  const corpus = extractionCorpus(crawl, NAME, 60_000);
  assert.ok(corpus.includes(`${long.slice(0, 20_000)}\n[cut for length]`), 'one page is at most 20,000 characters');
  assert.ok(corpus.includes('Fresh bread and pastry since 2014.'));
  for (const budget of [1_000, 1_500, 5_000]) {
    const small = extractionCorpus(crawl, NAME, budget);
    assert.ok(small.length <= budget, `${small.length} <= ${budget}`);
    assert.ok(small.endsWith('[cut for length]') || !small.includes('## Menu page'), 'a cut page is marked as cut');
  }
});

test('grounding text folds case, accents, quotes, punctuation and thousands separators', () => {
  const e = String.fromCharCode(0xe9);
  const apostrophe = String.fromCharCode(0x2019);
  const dash = String.fromCharCode(0x2014);
  assert.equal(
    groundingText(`Maple Row${apostrophe}s  Caf${e} Cr${e}me ${dash} 1,200.00!`),
    "maple row's cafe creme 1200.00",
  );
  assert.equal(groundingText('Seeded Rye\n$10.50'), 'seeded rye $10.50');
  assert.equal(groundingText('1,2345 and 12,345'), '1 2345 and 12345');
});
