import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MAX_GUEST_LABEL, guestLabelFor, parseGuestLabel } from './guest-label';

/**
 * Built rather than typed. A literal bidi override in a source file is exactly
 * the trick this test is about -- it would render the line around it backwards
 * for anyone reviewing the diff.
 */
const RTL_OVERRIDE = String.fromCharCode(0x202e);
const NUL = String.fromCharCode(0);

describe('parseGuestLabel', () => {
  it('accepts the names real guests actually have', () => {
    // An ASCII-only class here would refuse a large share of guests, which is a
    // worse failure than the one it prevents.
    for (const name of ['Sara D.', 'Иван', '李', 'Ana-Maria', 'Jo', "O'Neill"]) {
      assert.deepEqual(parseGuestLabel(name), { kind: 'ok', label: name }, name);
    }
  });

  it('treats nothing offered as absent, so the field is omitted not sent empty', () => {
    assert.deepEqual(parseGuestLabel(undefined), { kind: 'absent' });
    assert.deepEqual(parseGuestLabel(null), { kind: 'absent' });
    assert.deepEqual(parseGuestLabel('   '), { kind: 'absent' });
    assert.equal(guestLabelFor(''), undefined);
  });

  it('collapses whitespace, because a wall board has one line', () => {
    // "A          B" is a way of taking more of the board than a name should.
    assert.deepEqual(parseGuestLabel('  Sara    D.  '), { kind: 'ok', label: 'Sara D.' });
  });

  it('refuses anything longer than the board can carry', () => {
    const long = 'a'.repeat(MAX_GUEST_LABEL + 1);
    assert.deepEqual(parseGuestLabel(long), { kind: 'rejected', reason: 'too-long' });
    assert.equal(parseGuestLabel('a'.repeat(MAX_GUEST_LABEL)).kind, 'ok');
  });

  /**
   * board_tickets is granted to anon and the board hangs where the whole room
   * sees it, so this field is a broadcast channel.
   */
  it('folds a newline into the single line the board has, rather than refusing it', () => {
    // A newline is whitespace, and collapsing it cannot break the board's row.
    // Refusing the name outright would be a worse answer than flattening it.
    assert.deepEqual(parseGuestLabel('line\none'), { kind: 'ok', label: 'line one' });
  });

  it('refuses nul, direction overrides and anything link-shaped', () => {
    const hostile = [
      `nul${NUL}here`,
      `flip${RTL_OVERRIDE}reversed`,
      'a@b.com',
      '<b>x</b>',
      'http://x.example',
    ];
    for (const bad of hostile) {
      assert.deepEqual(
        parseGuestLabel(bad),
        { kind: 'rejected', reason: 'unsupported-characters' },
        JSON.stringify(bad),
      );
    }
  });

  it('refuses a value that is not a string at all', () => {
    assert.equal(parseGuestLabel(42).kind, 'rejected');
    assert.equal(parseGuestLabel({}).kind, 'rejected');
  });
});

describe('guestLabelFor', () => {
  it('omits the field for anything unusable rather than sending junk', () => {
    assert.equal(guestLabelFor('Sara D.'), 'Sara D.');
    assert.equal(guestLabelFor('a'.repeat(99)), undefined);
    assert.equal(guestLabelFor(`bad${RTL_OVERRIDE}name`), undefined);
  });
});
