import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compareSemVer, parseSemVer, satisfiesRange } from './semver';

describe('parseSemVer', () => {
  it('parses a plain release', () => {
    assert.deepEqual(parseSemVer('1.2.3'), { major: 1, minor: 2, patch: 3 });
    assert.deepEqual(parseSemVer('0.0.0'), { major: 0, minor: 0, patch: 0 });
  });

  it('rejects partial versions, prefixes, and prereleases', () => {
    assert.equal(parseSemVer('1.2'), null);
    assert.equal(parseSemVer('v1.2.3'), null);
    assert.equal(parseSemVer('1.2.3-rc.1'), null);
    assert.equal(parseSemVer('1.2.3.4'), null);
    assert.equal(parseSemVer(''), null);
  });
});

describe('compareSemVer', () => {
  it('orders by major, then minor, then patch', () => {
    const v = (text: string) => {
      const parsed = parseSemVer(text);
      assert.ok(parsed);
      return parsed;
    };
    assert.ok(compareSemVer(v('2.0.0'), v('1.9.9')) > 0);
    assert.ok(compareSemVer(v('1.3.0'), v('1.2.9')) > 0);
    assert.ok(compareSemVer(v('1.2.3'), v('1.2.4')) < 0);
    assert.equal(compareSemVer(v('1.2.3'), v('1.2.3')), 0);
  });
});

describe('satisfiesRange', () => {
  const v = (text: string) => {
    const parsed = parseSemVer(text);
    assert.ok(parsed);
    return parsed;
  };

  it('matches exact pins exactly', () => {
    assert.equal(satisfiesRange(v('1.2.3'), '1.2.3'), true);
    assert.equal(satisfiesRange(v('1.2.4'), '1.2.3'), false);
  });

  it('applies caret semantics within a major version', () => {
    assert.equal(satisfiesRange(v('1.4.0'), '^1.2.3'), true);
    assert.equal(satisfiesRange(v('2.0.0'), '^1.2.3'), false);
    assert.equal(satisfiesRange(v('1.2.2'), '^1.2.3'), false);
  });

  it('keeps caret narrow while the major version is zero', () => {
    assert.equal(satisfiesRange(v('0.2.5'), '^0.2.3'), true);
    assert.equal(satisfiesRange(v('0.3.0'), '^0.2.3'), false);
  });

  it('rejects malformed ranges instead of guessing', () => {
    assert.equal(satisfiesRange(v('1.2.3'), 'latest'), false);
    assert.equal(satisfiesRange(v('1.2.3'), '>=1.0.0'), false);
  });
});
