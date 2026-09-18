import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { OUTREACH_CSV_HEADER, outreachCsv, outreachFileName } from './outreach-csv';
import type { OutreachDraft } from './outreach-draft';

function draft(overrides: Partial<OutreachDraft> = {}): OutreachDraft {
  return {
    siteId: 'site-1',
    to: 'hello@harborroast.example',
    businessName: 'Harbor Roast',
    subject: 'A working ordering-app demo for Harbor Roast',
    text: 'Hello Harbor Roast team,\n\nhttps://hq.example.com/d/abc\n\nNorthside Studio',
    link: 'https://hq.example.com/d/abc',
    expiresOn: 'October 2, 2026',
    ...overrides,
  };
}

/** The records of a CSV whose cells are all quoted, split without a CSV library. */
function records(csv: string): string[][] {
  assert.ok(csv.endsWith('\r\n'), 'every record ends with CRLF');
  return csv.slice(0, -2).split('\r\n').map((record) => {
    const cells = record.match(/"(?:[^"]|"")*"/g) ?? [];
    assert.equal(cells.join(','), record, 'every cell is quoted and nothing sits between them');
    return cells.map((cell) => cell.slice(1, -1).replaceAll('""', '"'));
  });
}

describe('outreachCsv', () => {
  it('writes a header, then one record per draft, with the sender on every row', () => {
    const [header, row, ...rest] = records(outreachCsv([draft()], 'Northside Studio'));
    assert.deepEqual(header, [...OUTREACH_CSV_HEADER]);
    assert.deepEqual(row, [
      'hello@harborroast.example', 'Harbor Roast', 'A working ordering-app demo for Harbor Roast',
      'Hello Harbor Roast team,\n\nhttps://hq.example.com/d/abc\n\nNorthside Studio',
      'https://hq.example.com/d/abc', 'October 2, 2026', 'Northside Studio',
    ]);
    assert.deepEqual(rest, []);
  });

  it('keeps a body’s line breaks and quotes inside its own cell', () => {
    const [, row] = records(outreachCsv([draft({ businessName: 'The "Best" Cafe' })], 'Northside Studio'));
    assert.equal(row?.[1], 'The "Best" Cafe');
    assert.equal(row?.[3]?.split('\n').length, 5);
  });

  it('never hands a spreadsheet a formula, whatever a scraped name starts with', () => {
    for (const name of ['=HYPERLINK("http://x","y")', '+1 Cafe', '-Cafe', '@Cafe', '\tCafe']) {
      const [, row] = records(outreachCsv([draft({ businessName: name, subject: name })], 'Northside Studio'));
      assert.equal(row?.[1], `'${name}`, name);
      assert.equal(row?.[2], `'${name}`, name);
    }
  });

  it('is only a header when there is nothing to send', () => {
    assert.equal(outreachCsv([], 'Northside Studio').split('\r\n').length, 2);
  });
});

describe('outreachFileName', () => {
  it('names the file for its day', () => {
    assert.equal(outreachFileName('2026-09-18'), 'demo-outreach-2026-09-18.csv');
  });
});
