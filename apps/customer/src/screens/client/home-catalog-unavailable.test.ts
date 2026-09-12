/**
 * When the live catalog fails to load, the home screen must say so and offer
 * a retry. It did neither: `useCustomerCatalog()` hands back the bundled
 * catalog until the live one arrives, and the vertical home rendered those
 * items straight through a failed load -- a menu the shop may not sell,
 * with nothing on screen about it -- while the neutral home disabled its
 * only button and left the guest nothing to do. The provider retries on its
 * own with backoff, which is invisible; that invisibility is the finding.
 *
 * Source assertions, like home-screen.test.ts: the app's tests run under
 * node with no renderer, and what is pinned is what each screen does with
 * `status` and `refresh`, not how it draws.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const CLIENT = join(process.cwd(), 'src', 'screens', 'client');
const vertical = readFileSync(join(CLIENT, 'home-screen.tsx'), 'utf8');
const neutral = readFileSync(join(CLIENT, 'base-home-screen.tsx'), 'utf8');
const provider = readFileSync(join(process.cwd(), 'src', 'state', 'catalog-context.tsx'), 'utf8');

describe('home screens surface a catalog that failed to load', () => {
  it('the provider still exposes the status and the retry the screens lean on', () => {
    assert.match(provider, /'demo' \| 'loading' \| 'live' \| 'unavailable'/);
    assert.match(provider, /refresh: \(\) => void/);
  });

  it('the vertical home swaps its catalog sections for an error state with a retry', () => {
    assert.match(vertical, /status: catalogStatus, refresh: refreshCatalog/,
      'home-screen must read the catalog status and its refresh');
    const fork = vertical.indexOf("catalogStatus === 'unavailable' ?");
    assert.ok(fork >= 0, 'home-screen renders bundled items straight through a failed load');
    assert.match(vertical, /<ErrorState[\s\S]*?onRetry=\{refreshCatalog\}/,
      'the error state must hand the guest the provider\'s retry');
    // The feature rows and catalog sections are the very items the failed
    // load could not confirm, so they belong on the other side of the fork.
    const afterFork = vertical.slice(fork);
    assert.match(afterFork, /<HomeFeatureSections/);
    assert.match(afterFork, /<HomeCatalogSections/);
  });

  it('the neutral home offers a retry instead of a disabled button', () => {
    assert.match(neutral, /status === 'unavailable' \? 'Try again' : 'Browse catalog'/);
    assert.match(neutral, /status === 'unavailable' \? refresh :/);
    assert.doesNotMatch(neutral, /disabled=\{status === 'unavailable'\}/,
      'a disabled button gives the guest nothing to do about the outage');
  });
});
