import assert from 'node:assert/strict';
import test from 'node:test';

import { MAX_CONTACT_EMAILS, contactEmails, emailsInMailto, emailsInText } from './contact-emails';

const HOST = 'maplerowbakehouse.com';

test('a mailto link yields its addresses without the query, decoded', () => {
  assert.deepEqual(emailsInMailto('mailto:Orders@MapleRowBakehouse.com?subject=Order%20ahead'), ['Orders@MapleRowBakehouse.com']);
  assert.deepEqual(emailsInMailto('MAILTO:info%40maplerowbakehouse.com'), ['info@maplerowbakehouse.com']);
  assert.deepEqual(emailsInMailto('mailto:a@maplerowbakehouse.com,b@maplerowbakehouse.com'), ['a@maplerowbakehouse.com', 'b@maplerowbakehouse.com']);
  assert.deepEqual(emailsInMailto('/contact'), []);
  assert.deepEqual(emailsInMailto('mailto:%E0%A4%A'), ['%E0%A4%A']);
});

test('plain addresses are found in text; obfuscated spellings are left alone', () => {
  const text = 'Write to info@maplerowbakehouse.com. Wholesale: wholesale [at] maplerowbakehouse.com, or orders(at)maplerowbakehouse(dot)com.';
  assert.deepEqual(emailsInText(text), ['info@maplerowbakehouse.com']);
});

test('only the site own domain, www and apex alike, or a mailbox provider is kept', () => {
  const kept = contactEmails([
    'info@maplerowbakehouse.com',
    'bakers@www.maplerowbakehouse.com',
    'maplerowbakehouse@gmail.com',
    'owner@outlook.com',
    'studio@photovendor.net',
    'support@webvendor.io',
    'abc123@o450.ingest.sentry.io',
    'user@sentry.wixpress.com',
    'hello@mail.maplerowbakehouse.com',
  ], `www.${HOST}`);
  assert.deepEqual(kept, [
    'info@maplerowbakehouse.com', 'bakers@www.maplerowbakehouse.com', 'maplerowbakehouse@gmail.com', 'owner@outlook.com',
  ]);
});

test('junk that merely contains an @ is rejected', () => {
  const kept = contactEmails([
    'logo@2x.png', 'hero-image@3x.webp', 'you@example.com', 'name@domain.com', 'someone@maplerowbakehouse',
    'x@maplerowbakehouse.c0m', '.info@maplerowbakehouse.com', 'in..fo@maplerowbakehouse.com',
  ], HOST);
  assert.deepEqual(kept, []);
});

test('addresses are lowercased, deduplicated, ordered by how a business reads them, and capped', () => {
  const kept = contactEmails([
    'maplerowbakehouse@gmail.com',
    'Jamie@MapleRowBakehouse.com',
    'ORDERS@maplerowbakehouse.com',
    'hello@maplerowbakehouse.com',
    'jamie@maplerowbakehouse.com',
    'contact@maplerowbakehouse.com',
    'info@maplerowbakehouse.com',
    'events@maplerowbakehouse.com',
  ], HOST);
  assert.deepEqual(kept, [
    'info@maplerowbakehouse.com',
    'hello@maplerowbakehouse.com',
    'contact@maplerowbakehouse.com',
    'orders@maplerowbakehouse.com',
    'jamie@maplerowbakehouse.com',
  ]);
  assert.equal(kept.length, MAX_CONTACT_EMAILS);
});
