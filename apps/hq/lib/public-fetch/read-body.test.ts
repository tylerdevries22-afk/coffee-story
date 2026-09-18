import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
import { deflateSync } from 'node:zlib';

import { CrawlBudget } from './budget';
import { failure, thrown } from './fakes.test-support';
import { decodedBody, readBoundedBody } from './read-body';

test('an identity body is read as it came, chunk by chunk', async () => {
  const body = Readable.from([Buffer.from('robots'), Buffer.from('.txt')]);
  const budget = new CrawlBudget();
  const bytes = await readBoundedBody(body, 'identity', 100, budget);
  assert.equal(bytes.toString('utf8'), 'robots.txt');
  assert.equal(budget.usage().bytes, 10);
});

test('deflate is decoded, and string chunks are accepted as UTF-8', async () => {
  const compressed = await readBoundedBody(Readable.from([deflateSync('User-agent: *')]), 'deflate', 100, new CrawlBudget());
  assert.equal(compressed.toString('utf8'), 'User-agent: *');
  const text = await readBoundedBody(Readable.from(['Disallow: /private']), undefined, 100, new CrawlBudget());
  assert.equal(text.toString('utf8'), 'Disallow: /private');
});

test('an unknown coding is refused and the socket released', () => {
  const body = Readable.from([Buffer.from('x')]);
  assert.equal(thrown(() => decodedBody(body, 'x-custom')).code, 'wrong_type');
  assert.equal(body.destroyed, true);
  const plain = Readable.from([]);
  assert.equal(decodedBody(plain, ' Identity '), plain);
});

test('a connection that drops part-way is a network error', async () => {
  let sent = false;
  const body = new Readable({
    read() {
      if (sent) this.destroy(new Error('read ECONNRESET'));
      else this.push(Buffer.from('<html>'));
      sent = true;
    },
  });
  assert.equal((await failure(readBoundedBody(body, undefined, 100, new CrawlBudget()))).code, 'network');
});

test('the cap is counted in decoded bytes and the budget is charged only for what was kept', async () => {
  const budget = new CrawlBudget();
  const body = Readable.from([Buffer.alloc(60), Buffer.alloc(60)]);
  assert.equal((await failure(readBoundedBody(body, undefined, 100, budget))).code, 'too_large');
  assert.equal(budget.usage().bytes, 60);
});
