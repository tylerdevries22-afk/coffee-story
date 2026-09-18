import assert from 'node:assert/strict';
import test from 'node:test';

import {
  elementHint, imageSource, largestSrcsetCandidate, pixelDimension, relTokens,
} from './html-attributes';
import { readPageFacts } from './html-facts';
import { fixture } from './site-fixtures.test-support';

const home = readPageFacts(fixture('home.html'));

test('metadata is read once per key, with entities decoded', () => {
  assert.equal(home.title, 'Maple Row Bakehouse | Bread, Pastry & Coffee in Ashford Springs');
  assert.equal(home.meta['og:site_name'], 'Maple Row Bakehouse');
  assert.equal(home.meta['theme-color'], '#7A3E1D');
  assert.equal(home.meta.description?.startsWith('A neighbourhood bakehouse'), true);
});

test('visible text keeps the page and drops script, style and head', () => {
  assert.match(home.text, /Fresh bread & pastry since 2014/);
  assert.match(home.text, /bakes sourdough, croissants and seasonal tarts/);
  assert.doesNotMatch(home.text, /this is script/);
  assert.doesNotMatch(home.text, /--brand-primary/);
  assert.doesNotMatch(home.text, /Maple Row Bakehouse \| Bread/);
});

test('a price column stays apart from the item it prices', () => {
  const menu = readPageFacts(fixture('menu.html'));
  assert.match(menu.text, /^Butter Croissant 4\.25$/m);
  assert.match(menu.text, /^Country Sourdough \$9\.00$/m);
});

test('links carry their text and whether they sit in the site chrome', () => {
  const menu = home.links.find((link) => link.href === '/menu/');
  assert.deepEqual(menu, { href: '/menu/', text: 'Menu', inChrome: true });
  const oven = home.links.find((link) => link.href === '/blog/2023/05/new-oven');
  assert.equal(oven?.inChrome, false);
  assert.ok(home.links.some((link) => link.href.startsWith('mailto:Orders@')));
});

test('images, icons, stylesheets, inline CSS and structured data are all collected', () => {
  const logo = home.images.find((image) => image.hint.includes('logo'));
  assert.equal(logo?.src, '/images/maple-row-logo.png');
  assert.equal(logo?.inChrome, true);
  assert.equal(logo?.width, 240);
  // A lazy image's real picture is its widest srcset candidate, not the placeholder.
  assert.ok(home.images.some((image) => image.src === '/images/croissants-1600.jpg'));
  assert.ok(!home.images.some((image) => image.src.startsWith('data:')));
  // Images inside <noscript> are fallbacks for tracking or lazy loading, never content.
  assert.ok(!home.images.some((image) => image.src.includes('pixel')));
  assert.deepEqual(home.stylesheets, ['/assets/site.css', 'https://fonts.googleapis.com/css2?family=Lora']);
  assert.deepEqual(home.icons.map((icon) => icon.href), ['/apple-touch-icon.png', '/favicon-32x32.png', '/favicon.svg']);
  assert.equal(home.inlineStyles.length, 1);
  assert.match(home.inlineStyles[0] ?? '', /--brand-accent/);
  assert.equal(home.jsonLd.length, 1);
  assert.match(home.jsonLd[0] ?? '', /"Bakery"/);
});

test('an unclosed, messy page still parses and stays bounded', () => {
  const messy = readPageFacts(`<p>one<p>two<div><a href="/x">three<img src="/i.png"></div><title>late</title>${'<a href="/l">x</a>'.repeat(1_000)}`);
  assert.match(messy.text, /one\ntwo\nthree/);
  assert.equal(messy.title, 'late');
  assert.equal(messy.links.length, 400);
});

test('attribute readers', () => {
  assert.deepEqual(relTokens(' Apple-Touch-Icon  precomposed '), ['apple-touch-icon', 'precomposed']);
  assert.equal(pixelDimension('240'), 240);
  assert.equal(pixelDimension('240px'), 240);
  assert.equal(pixelDimension('100%'), null);
  assert.equal(pixelDimension(undefined), null);
  assert.equal(largestSrcsetCandidate('/a.jpg 400w, /b.jpg 1200w, /c.jpg 800w'), '/b.jpg');
  assert.equal(largestSrcsetCandidate('/a.jpg 1x, /b.jpg 2x'), '/b.jpg');
  assert.equal(largestSrcsetCandidate(''), null);
  assert.equal(imageSource({ src: 'data:image/gif;base64,xyz' }), null);
  assert.equal(imageSource({ src: '/placeholder.gif', 'data-src': '/real.jpg' }), '/real.jpg');
  assert.equal(elementHint({ alt: 'Our Logo', class: 'site-mark' }, '/img/brand.png?v=2'), 'our logo site-mark brand.png');
});
