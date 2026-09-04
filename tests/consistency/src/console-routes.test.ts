import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

/**
 * Every console page is reachable, and every navigation link goes somewhere.
 *
 * Two failures this catches, and they are opposite. A nav entry pointing at a
 * page that was renamed or deleted is a 404 a reviewer will not click; a page
 * shipped with no route into it is either dead code or a feature nobody can
 * find. Both are invisible to typecheck, because the href is a string.
 *
 * The inventory is also where the answer to "is this page gated" lives. Console
 * pages are deliberately thin -- most are a few lines that await a loader --
 * so gating sits in the loader, not the page, and grepping pages for a role
 * check finds nothing and means nothing. What can be checked statically is
 * that the set of pages and the set of routes into them agree.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const HQ = join(ROOT, 'apps/hq');
const CONSOLE = join(HQ, 'app/(console)');

function pageRoutes(dir: string, base = ''): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...pageRoutes(full, `${base}/${entry}`));
    else if (entry === 'page.tsx') found.push(base === '' ? '/' : base);
  }
  return found.sort();
}

const routes = pageRoutes(CONSOLE);

function sourcesUnder(dir: string): { path: string; source: string }[] {
  const found: { path: string; source: string }[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.next')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...sourcesUnder(full));
    else if (/\.tsx?$/.test(entry) && !entry.includes('.test.')) {
      found.push({ path: relative(HQ, full), source: readFileSync(full, 'utf8') });
    }
  }
  return found;
}

const hqSources = sourcesUnder(HQ);

/** Every quoted absolute path that appears anywhere in the console's own source. */
const referenced = new Set<string>();
for (const { source } of hqSources) {
  for (const match of source.matchAll(/['"`](\/[a-z0-9\-[\]/]*)['"`]/gi)) {
    if (match[1]) referenced.add(match[1]);
  }
}

/**
 * Pages with no inbound link from the console, and the reason each is fine.
 *
 * A page reached only by typing its URL is not automatically wrong -- a legacy
 * bookmark, a device that is handed a link once, an auth screen the middleware
 * redirects to. It is wrong when nobody decided that. So the decision lives
 * here, and a new unreachable page fails until someone writes down which of
 * these it is.
 */
const NOT_LINKED: Readonly<Record<string, string>> = {
  '/login': 'the middleware redirects here; linking to it from the shell would be circular',
};

/**
 * Pages that exist only to forward an old URL, asserted to keep forwarding.
 *
 * These are the reason /content and /wall have no nav entry: they are not
 * features, they are bookmarks. A redirect that lost its `redirect()` call
 * becomes a blank page for anyone still holding the old link, and nothing else
 * would notice.
 */
const LEGACY_REDIRECTS: Readonly<Record<string, string>> = {
  '/content': '/catalog',
  '/wall': '/apps/display',
};

describe('console route inventory', () => {
  it('finds the console tree, so the suite cannot pass by enumerating nothing', () => {
    assert.ok(routes.length > 40, `found only ${routes.length} console pages`);
    assert.ok(hqSources.length > 100, `found only ${hqSources.length} HQ sources`);
  });

  it('has a page behind every navigation href', () => {
    const navSources = hqSources.filter(({ path }) => /console-(sections|navigation)|app-previews/.test(path));
    assert.ok(navSources.length >= 3, 'the navigation modules moved; this test is looking at nothing');
    const hrefs = new Set<string>();
    for (const { source } of navSources) {
      for (const match of source.matchAll(/href: '([^']+)'/g)) {
        if (match[1]) hrefs.add(match[1]);
      }
    }
    assert.ok(hrefs.size > 25, `found only ${hrefs.size} navigation hrefs`);
    const dangling = [...hrefs].filter((href) => !routes.includes(href)).sort();
    assert.deepEqual(dangling, [], 'these navigation entries point at no page');
  });

  it('has a route into every page', () => {
    const orphans = routes
      .filter((route) => route !== '/')
      // A dynamic segment is reached by construction, never by a literal.
      .filter((route) => !route.includes('['))
      .filter((route) => !(route in NOT_LINKED))
      .filter((route) => !(route in LEGACY_REDIRECTS))
      .filter((route) => !referenced.has(route))
      .sort();
    assert.deepEqual(orphans, [],
      'these pages have no link into them. Add one, or record why not in '
      + 'NOT_LINKED or LEGACY_REDIRECTS.');
  });

  it('keeps every legacy redirect redirecting', () => {
    for (const [from, to] of Object.entries(LEGACY_REDIRECTS)) {
      assert.ok(routes.includes(from), `${from} no longer exists; drop the entry`);
      const page = readFileSync(join(CONSOLE, from.slice(1), 'page.tsx'), 'utf8');
      assert.match(page, /\bredirect\(/,
        `${from} exists only to forward an old bookmark and no longer redirects`);
      assert.ok(page.includes(to),
        `${from} should forward to ${to}`);
    }
  });

  it('records the unreachable pages deliberately, not as a growing list', () => {
    assert.equal(Object.keys(NOT_LINKED).length, 1);
    assert.equal(Object.keys(LEGACY_REDIRECTS).length, 2);
  });
});

/**
 * The nav is filtered by capability, and the filter is the only thing between a
 * tenant and a section it did not buy.
 *
 * Typing the URL still renders the page -- gating lives in each loader, which
 * returns an empty workspace to a caller the database would refuse -- so this
 * is about what the console *offers*, not about data isolation. A section
 * rendered unconditionally advertises a feature the tenant does not have, and
 * for a franchise platform whose tenants compete, that is also a disclosure of
 * what the platform sells.
 */
describe('capability-gated navigation sections', () => {
  const navigation = readFileSync(join(HQ, 'lib/console-navigation.ts'), 'utf8');
  const sections = readFileSync(join(HQ, 'lib/console-sections.ts'), 'utf8');

  for (const [section, flag] of [
    ['DROPS_SECTION', 'canManageDrops'],
    ['CAMPAIGNS_SECTION', 'canManageCampaigns'],
    ['OPERATIONS_SECTION', 'canManageOperations'],
    ['INTEGRATIONS_SECTION', 'canViewIntegrations'],
  ] as const) {
    it(`renders ${section} only behind ${flag}`, () => {
      assert.match(navigation, new RegExp(`access\\.${flag}\\s*\\?\\s*\\[${section}\\]`),
        `${section} must be gated on access.${flag}`);
    });
  }

  it('gates the operations analytics entry, which sits inside a section gated only on analytics', () => {
    assert.match(sections, /access\.canManageOperations[\s\S]{0,120}\/analytics\/operations/,
      'a tenant without the operations module was offered its analytics page');
  });
});
