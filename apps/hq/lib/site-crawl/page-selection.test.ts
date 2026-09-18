import assert from 'node:assert/strict';
import test from 'node:test';

import type { LinkFact } from './html-facts';
import { MAX_PAGES, choosePages, pageTopic, pageUrl, sameSite, siteHost } from './page-selection';

const HOME = new URL('https://www.maplerowbakehouse.com/');
const link = (href: string, text = '', inChrome = false): LinkFact => ({ href, text, inChrome });

test('www and the bare domain are one site; other hosts are not', () => {
  assert.equal(siteHost(HOME), 'maplerowbakehouse.com');
  assert.equal(sameSite(new URL('https://maplerowbakehouse.com/menu'), HOME), true);
  assert.equal(sameSite(new URL('https://shop.maplerowbakehouse.com/'), HOME), false);
  assert.equal(sameSite(new URL('https://maplerowbakehouse.com.evil.example/'), HOME), false);
});

test('a page topic comes from its address or the label that linked to it', () => {
  assert.equal(pageTopic(new URL('https://a.example/')), 'home');
  assert.equal(pageTopic(new URL('https://a.example/our-menu')), 'menu');
  assert.equal(pageTopic(new URL('https://a.example/p/42'), 'Food & Drink'), 'menu');
  assert.equal(pageTopic(new URL('https://a.example/services/')), 'services');
  assert.equal(pageTopic(new URL('https://a.example/contact-us')), 'contact');
  assert.equal(pageTopic(new URL('https://a.example/our-story')), 'about');
  assert.equal(pageTopic(new URL('https://a.example/gallery')), 'other');
});

test('only same-site pages are crawlable, upgraded to https and without fragments', () => {
  assert.equal(pageUrl('/menu#drinks', HOME, HOME)?.href, 'https://www.maplerowbakehouse.com/menu');
  assert.equal(pageUrl('http://maplerowbakehouse.com/visit', HOME, HOME)?.href, 'https://maplerowbakehouse.com/visit');
  assert.equal(pageUrl('/menu.html', HOME, HOME)?.pathname, '/menu.html');
  for (const href of [
    'https://elsewhere.example/menu', 'mailto:info@maplerowbakehouse.com', 'tel:+15550100', 'javascript:void(0)',
    '/menu.pdf', '/images/loaf.jpg', '/cart', '/my-account/orders', '/privacy-policy/../privacy', '/wp-login.php?x=1', '/tag/bread',
  ]) {
    assert.equal(pageUrl(href, HOME, HOME), null, href);
  }
});

test('menu, services, contact and about pages win, nav links fill, junk never enters', () => {
  const links = [
    link('/blog/2023/05/new-oven', 'We got a new oven'),
    link('/our-story', 'Our Story', true),
    link('/gallery', 'Gallery', true),
    link('/visit', 'Visit'),
    link('/menu/', 'Menu', true),
    link('/menu', 'Full menu'),
    link('/cart', 'Cart', true),
    link('https://www.instagram.com/maplerowbakehouse/', 'Instagram'),
    link('/catering', 'Catering', true),
  ];
  const chosen = choosePages(links, HOME, (url) => url.pathname !== '/catering');
  assert.deepEqual(chosen.map((page) => [page.url.pathname, page.topic]), [
    ['/menu/', 'menu'],
    // An about page in the nav ties a contact page outside it; the earlier link wins.
    ['/our-story', 'about'],
    ['/visit', 'contact'],
    ['/gallery', 'other'],
  ]);
});

test('the selection never exceeds the page budget, homepage included', () => {
  const links = Array.from({ length: 30 }, (_, index) => link(`/menu-${index}`, 'Menu', true));
  assert.equal(choosePages(links, HOME, () => true).length, MAX_PAGES - 1);
  assert.equal(choosePages(links, HOME, () => true, 3).length, 3);
  assert.deepEqual(choosePages([link('/', 'Home', true), link('/index', 'Home')], HOME, () => true), []);
});
