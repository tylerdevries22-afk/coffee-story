import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildCsv, csvEscape } from './csv';

describe('csvEscape', () => {
  it('quotes only when needed and doubles inner quotes', () => {
    assert.equal(csvEscape('plain'), 'plain');
    assert.equal(csvEscape('a,b'), '"a,b"');
    assert.equal(csvEscape('say "hi"'), '"say ""hi"""');
    assert.equal(csvEscape('line\nbreak'), '"line\nbreak"');
  });
});

describe('buildCsv', () => {
  it('emits CRLF rows with a header', () => {
    const csv = buildCsv(['name', 'revenue'], [['Downtown', 26124], ['Up,town', 15342]]);
    assert.equal(csv, 'name,revenue\r\nDowntown,26124\r\n"Up,town",15342\r\n');
  });
});
