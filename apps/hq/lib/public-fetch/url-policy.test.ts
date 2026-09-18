import assert from 'node:assert/strict';
import test from 'node:test';

import { thrown } from './fakes.test-support';
import { bareHostname, parsePublicUrl } from './url-policy';

test('a standard public https URL passes, with its fragment dropped and :443 folded away', () => {
  assert.equal(parsePublicUrl('https://example.com/menu?page=2#drinks').href, 'https://example.com/menu?page=2');
  assert.equal(parsePublicUrl('https://Example.COM:443/').href, 'https://example.com/');
  assert.equal(parsePublicUrl(new URL('https://www.example.com/about')).href, 'https://www.example.com/about');
});

test('every scheme but https is refused as an invalid URL', () => {
  for (const value of [
    'http://example.com/', 'ftp://example.com/', 'ws://example.com/', 'file:///etc/passwd',
    'data:text/html,hello', 'javascript:alert(1)', 'gopher://example.com/',
  ]) {
    assert.equal(thrown(() => parsePublicUrl(value)).code, 'invalid_url', value);
  }
});

test('credentials and non-default ports are refused before anything resolves', () => {
  for (const value of [
    'https://user@example.com/', 'https://user:pw@example.com/', 'https://:pw@example.com/',
    'https://example.com:8443/', 'https://example.com:80/', 'https://example.com:0/', 'https://example.com:22/',
  ]) {
    assert.equal(thrown(() => parsePublicUrl(value)).code, 'invalid_url', value);
  }
});

test('private address literals are refused, including encoded and bracketed spellings', () => {
  for (const value of [
    'https://127.0.0.1/', 'https://10.0.0.1/', 'https://169.254.169.254/latest/meta-data/',
    'https://198.51.100.7/', 'https://203.0.113.9/', 'https://100.64.0.1/', 'https://0.0.0.0/',
    // The URL parser normalises these to 127.0.0.1 before the policy sees them.
    'https://2130706433/', 'https://0x7f.0.0.1/', 'https://0177.0.0.1/', 'https://127.1/',
    'https://[::1]/', 'https://[::ffff:127.0.0.1]/', 'https://[0:0:0:0:0:ffff:7f00:1]/', 'https://[::ffff:8.8.8.8]/',
    'https://[fd00::1]/', 'https://[fe80::1]/', 'https://[ff02::1]/', 'https://[64:ff9b::a00:1]/',
    'https://[2001:db8::1]/', 'https://[2002:c0a8:101::1]/', 'https://[2001::1]/',
  ]) {
    assert.equal(thrown(() => parsePublicUrl(value)).code, 'not_public', value);
  }
});

test('public address literals pass', () => {
  assert.equal(parsePublicUrl('https://8.8.8.8/').hostname, '8.8.8.8');
  assert.equal(parsePublicUrl('https://[2606:4700:4700::1111]/').hostname, '[2606:4700:4700::1111]');
});

test('names that only resolve on the machine or the LAN are refused by name', () => {
  for (const value of [
    'https://localhost/', 'https://LOCALHOST./', 'https://api.localhost/', 'https://printer.local/',
    'https://db.internal/', 'https://nas.home.arpa/', 'https://intranet/',
  ]) {
    assert.equal(thrown(() => parsePublicUrl(value)).code, 'not_public', value);
  }
});

test('a redirect location resolves against the current URL and meets the same policy', () => {
  const base = new URL('https://example.com/menu/');
  assert.equal(parsePublicUrl('../about', base).href, 'https://example.com/about');
  assert.equal(parsePublicUrl('//cdn.example.net/site.css', base).href, 'https://cdn.example.net/site.css');
  assert.equal(thrown(() => parsePublicUrl('http://example.com/', base)).code, 'invalid_url');
  assert.equal(thrown(() => parsePublicUrl('https://127.0.0.1/', base)).code, 'not_public');
  assert.equal(thrown(() => parsePublicUrl('//[::1]/', base)).code, 'not_public');
});

test('input that does not parse is an invalid URL', () => {
  for (const value of ['', 'not a url', 'https://', 'https://exa mple.com/', 'https://[::1/']) {
    assert.equal(thrown(() => parsePublicUrl(value)).code, 'invalid_url', JSON.stringify(value));
  }
});

test('bareHostname is what a resolver sees', () => {
  assert.equal(bareHostname('[2606:4700:4700::1111]'), '2606:4700:4700::1111');
  assert.equal(bareHostname('Example.COM.'), 'example.com');
  assert.equal(bareHostname('example.com'), 'example.com');
});
