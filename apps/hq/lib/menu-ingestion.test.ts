import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  extractedMenuCsv, validateMenuSource, validateMenuSourceMetadata,
} from './menu-ingestion';

describe('menu source validation', () => {
  it('checks bytes as well as the declared format', () => {
    assert.equal(validateMenuSource({
      bytes: new TextEncoder().encode('%PDF-1.7'), filename: 'menu.pdf', mime: 'application/pdf',
    }), null);
    assert.match(validateMenuSource({
      bytes: new TextEncoder().encode('not a pdf'), filename: 'menu.pdf', mime: 'application/pdf',
    }) ?? '', /contents/);
  });

  it('rejects unsupported and oversized files before reading their bytes', () => {
    assert.match(validateMenuSourceMetadata({ mime: 'text/html', size: 10 }) ?? '', /PDF/);
    assert.match(validateMenuSourceMetadata({
      mime: 'application/pdf', size: 8 * 1024 * 1024 + 1,
    }) ?? '', /8 MB/);
  });
});

describe('extractedMenuCsv', () => {
  it('produces reviewable CSV only when every row satisfies the shared parser', () => {
    const csv = extractedMenuCsv({ rows: [{
      slug: 'oat-latte', name: 'Oat Latte', category: 'Drinks',
      description: 'Espresso, oat milk', base_price_cents: 550, sizes: '12:550|16:625',
    }] });
    assert.match(csv ?? '', /^slug,name,category,description,base_price_cents,sizes\r?\n/);
    assert.match(csv ?? '', /"Espresso, oat milk"/);
  });

  it('rejects malformed or unbounded provider output', () => {
    assert.equal(extractedMenuCsv({ rows: [{ slug: '../bad' }] }), null);
    assert.equal(extractedMenuCsv({ rows: [] }), null);
  });
});
