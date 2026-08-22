import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseCsvLine, parseMenuCsv } from './menu-csv';

const HEADER = 'slug,name,category,description,base_price_cents,sizes';

describe('parseCsvLine', () => {
  it('handles quotes, embedded commas, and doubled quotes', () => {
    assert.deepEqual(parseCsvLine('a,"b, c","say ""hi""",d'), ['a', 'b, c', 'say "hi"', 'd']);
  });
});

describe('parseMenuCsv', () => {
  it('parses rows with size ladders', () => {
    const { rows, errors } = parseMenuCsv([
      HEADER,
      'oat-latte,Oat Latte,Espresso,"Silky, with house oat milk",550,12:550|16:625',
      'croissant,Croissant,Pastry,Butter layers,450,',
    ].join('\n'));
    assert.deepEqual(errors, []);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows[0]?.sizes, [
      { slug: '12', label: '12 oz', price_cents: 550 },
      { slug: '16', label: '16 oz', price_cents: 625 },
    ]);
    assert.equal(rows[1]?.sizes.length, 0);
  });

  it('rejects dollars, bad slugs, and duplicates with line numbers', () => {
    const { rows, errors } = parseMenuCsv([
      HEADER,
      'ok,Fine,Espresso,,450,',
      'Bad Slug,Nope,Espresso,,450,',
      'dollars,Nope,Espresso,,4.50,',
      'ok,Again,Espresso,,450,',
    ].join('\n'));
    assert.equal(rows.length, 2);
    assert.equal(errors.length, 3);
    assert.ok(errors[0]?.includes('line 3'));
    assert.ok(errors[1]?.includes('cents, never dollars'));
    assert.ok(errors[2]?.includes('Duplicate slug'));
  });

  it('refuses a wrong header outright', () => {
    const { rows, errors } = parseMenuCsv('name,price\nCortado,450');
    assert.equal(rows.length, 0);
    assert.equal(errors.length, 1);
  });
});
