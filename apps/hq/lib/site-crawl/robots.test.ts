import assert from 'node:assert/strict';
import test from 'node:test';

import { ALLOW_ALL, DISALLOW_ALL, parseRobots, robotsAllows, robotsPatternMatches } from './robots';
import { fixture } from './site-fixtures.test-support';

const TOKEN = 'OrderingDemoBuilder';

test('the wildcard group applies when no group names this crawler', () => {
  const rules = parseRobots(fixture('robots.txt'), TOKEN);
  assert.equal(robotsAllows(rules, '/menu/'), true);
  assert.equal(robotsAllows(rules, '/catering'), false);
  assert.equal(robotsAllows(rules, '/catering/weddings'), false);
  assert.equal(robotsAllows(rules, '/wp-admin/options.php'), false);
  // The longer Allow beats the shorter Disallow.
  assert.equal(robotsAllows(rules, '/wp-admin/admin-ajax.php'), true);
});

test('a group naming this crawler replaces the wildcard group, case-insensitively and with a version', () => {
  const text = [
    'User-agent: *', 'Disallow: /',
    '', 'User-agent: orderingdemobuilder/1.0', 'Disallow: /private',
  ].join('\n');
  const rules = parseRobots(text, TOKEN);
  assert.equal(robotsAllows(rules, '/menu'), true);
  assert.equal(robotsAllows(rules, '/private/notes'), false);
  assert.equal(robotsAllows(parseRobots(text, 'SomeOtherBot'), '/menu'), false);
});

test('groups sharing agents merge, comments and unknown keys are ignored, and an empty Disallow allows', () => {
  const text = [
    '# comment', 'User-agent: a-bot', 'User-agent: *', 'Crawl-delay: 10', 'Disallow: /one # inline comment',
    'Sitemap: https://example.com/sitemap.xml', 'User-agent: *', 'Disallow: /two', 'Disallow:',
  ].join('\r\n');
  const rules = parseRobots(text, TOKEN);
  assert.deepEqual(rules, { allow: [], disallow: ['/one', '/two'] });
});

test('on a tie in length, Allow wins; with no match, everything is allowed', () => {
  const rules = { allow: ['/page'], disallow: ['/page'] };
  assert.equal(robotsAllows(rules, '/page'), true);
  assert.equal(robotsAllows(ALLOW_ALL, '/anything'), true);
  assert.equal(robotsAllows(DISALLOW_ALL, '/'), false);
  assert.equal(robotsAllows(DISALLOW_ALL, '/menu?x=1'), false);
});

test('patterns: prefix by default, * matches any run, $ anchors the end', () => {
  const cases: [string, string, boolean][] = [
    ['/private', '/private/x', true],
    ['/private', '/priv', false],
    ['/*.pdf$', '/files/menu.pdf', true],
    ['/*.pdf$', '/files/menu.pdf?download=1', false],
    ['/*.pdf', '/files/menu.pdf?download=1', true],
    ['/$', '/', true],
    ['/$', '/about', false],
    ['*', '/anything', true],
    ['/a*b', '/axxbyy', true],
    ['/a*b*c$', '/abxc', true],
    ['/a*b*c$', '/abxcd', false],
    ['/shop/*/cart', '/shop/42/cart', true],
    ['/shop/*/cart', '/shop/42/checkout', false],
  ];
  for (const [pattern, path, expected] of cases) {
    assert.equal(robotsPatternMatches(pattern, path), expected, `${pattern} vs ${path}`);
  }
});

test('a hostile file cannot grow without bound', () => {
  const huge = ['User-agent: *', ...Array.from({ length: 5_000 }, (_, index) => `Disallow: /p${index}`)].join('\n');
  assert.equal(parseRobots(huge, TOKEN).disallow.length, 500);
  const long = `User-agent: *\nDisallow: /${'a*'.repeat(400)}`;
  assert.deepEqual(parseRobots(long, TOKEN).disallow, []);
});
