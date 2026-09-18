import assert from 'node:assert/strict';
import test from 'node:test';

import { readPageFacts } from './html-facts';
import { readJsonLd } from './json-ld';
import { imageCandidates, logoCandidates, mediaUrl } from './media-candidates';
import { fixture } from './site-fixtures.test-support';
import { socialLinks, socialNetwork } from './social-links';

const WWW = new URL('https://www.maplerowbakehouse.com/');

test('profiles are kept one per network; share buttons and bare hosts are not', () => {
  const links = socialLinks([
    'https://www.facebook.com/sharer/sharer.php?u=https://www.maplerowbakehouse.com',
    'http://instagram.com/maplerowbakehouse/?hl=en#top',
    'https://www.instagram.com/someone-else',
    'https://m.facebook.com/maplerowbakehouse',
    'https://twitter.com/intent/tweet?text=hi',
    'https://www.tiktok.com/@maplerowbakehouse?lang=en',
    'https://www.youtube.com/',
    'not a url',
    'https://www.maplerowbakehouse.com/instagram',
  ]);
  assert.deepEqual(links, [
    { network: 'instagram', url: 'https://instagram.com/maplerowbakehouse/' },
    { network: 'facebook', url: 'https://m.facebook.com/maplerowbakehouse' },
    { network: 'tiktok', url: 'https://www.tiktok.com/@maplerowbakehouse' },
  ]);
  assert.equal(socialNetwork(new URL('https://x.com/maplerow')), 'x');
  assert.equal(socialNetwork(new URL('https://example.com/')), null);
});

test('structured data gives the logo, profiles and email, and survives bad blocks', () => {
  const facts = readJsonLd([
    'not json',
    JSON.stringify({ '@graph': [
      { '@type': 'WebSite', name: 'x' },
      { '@type': 'Bakery', logo: 'https://www.maplerowbakehouse.com/logo.png', sameAs: 'https://www.instagram.com/maplerowbakehouse', email: 'MAILTO:hello@maplerowbakehouse.com' },
    ] }),
    JSON.stringify({ logo: { '@type': 'ImageObject', contentUrl: 'https://cdn.maplerowbakehouse.com/logo-2.png' } }),
  ]);
  assert.deepEqual(facts.logos, ['https://www.maplerowbakehouse.com/logo.png', 'https://cdn.maplerowbakehouse.com/logo-2.png']);
  assert.deepEqual(facts.sameAs, ['https://www.instagram.com/maplerowbakehouse']);
  assert.deepEqual(facts.emails, ['hello@maplerowbakehouse.com']);
});

test('logo candidates run from most to least deliberate, and skip what cannot be downloaded', () => {
  const home = readPageFacts(fixture('home.html'));
  const structured = readJsonLd(home.jsonLd);
  const logos = logoCandidates(home, WWW, structured.logos);
  assert.deepEqual(logos, [
    { url: 'https://www.maplerowbakehouse.com/images/maple-row-logo.png', source: 'json-ld' },
    { url: 'https://www.maplerowbakehouse.com/apple-touch-icon.png', source: 'touch-icon' },
    { url: 'https://cdn.maplerowbakehouse.com/share/storefront.jpg', source: 'og-image' },
    { url: 'https://www.maplerowbakehouse.com/favicon-32x32.png', source: 'icon' },
  ]);
});

test('photographs come from content, not chrome, logos, icons or declared-tiny images', () => {
  const home = readPageFacts(fixture('home.html'));
  const menu = readPageFacts(fixture('menu.html'));
  const images = imageCandidates([
    { url: WWW, facts: home },
    { url: new URL('/menu/', WWW), facts: menu },
  ]);
  assert.deepEqual(images.map((image) => image.url), [
    'https://cdn.maplerowbakehouse.com/share/storefront.jpg',
    'https://www.maplerowbakehouse.com/images/croissants-1600.jpg',
    'https://www.maplerowbakehouse.com/images/menu/sourdough.jpg',
    'https://www.maplerowbakehouse.com/images/menu/fruit-tart.webp',
  ]);
  assert.equal(images[2]?.alt, 'Country sourdough loaf');
});

test('a photograph is judged by whole words, so a custard tart is not a rating star', () => {
  const facts = readPageFacts([
    '<img src="/images/custard-tart.jpg" alt="Vanilla custard tart">',
    '<img src="/images/five-stars.png" alt="Five stars">',
    '<img src="/images/brand/favicon-large.png" alt="">',
  ].join(''));
  assert.deepEqual(imageCandidates([{ url: WWW, facts }]).map((image) => image.url), [
    'https://www.maplerowbakehouse.com/images/custard-tart.jpg',
  ]);
});

test('media addresses resolve against the page, upgrade to https and refuse SVG and ICO', () => {
  assert.equal(mediaUrl('/a.jpg#x', WWW), 'https://www.maplerowbakehouse.com/a.jpg');
  assert.equal(mediaUrl('http://cdn.example.net/a.png', WWW), 'https://cdn.example.net/a.png');
  assert.equal(mediaUrl('/logo.svg', WWW), null);
  assert.equal(mediaUrl('/favicon.ico', WWW), null);
  assert.equal(mediaUrl('ftp://example.net/a.png', WWW), null);
  assert.equal(mediaUrl('http://[', WWW), null);
});
