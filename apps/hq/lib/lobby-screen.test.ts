import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { lobbySectionsFor } from '@platform/domain';

import {
  lobbyRoutes,
  lobbyScreen,
  lobbySurfaceUrl,
  lobbyTenants,
  servesLobby,
} from './lobby-screen';
import { TENANT_ORGS, tenantOrgById } from './tenants';

/**
 * The claim this module has to keep is that a lobby screen belongs to ONE
 * building. Everything below is a way of failing if two properties ever start
 * sharing a screen, or if a tenant that never asked for one gets served it.
 */
describe('lobby screen', () => {
  const chain = lobbyTenants()[0];

  it('serves a screen only to a tenant that declares the surface', () => {
    assert.ok(chain, 'no tenant in the registry declares a lobby');
    for (const org of TENANT_ORGS) {
      const declared = (org.brandConfig as { surfaces?: string[] }).surfaces ?? [];
      assert.equal(servesLobby(org), declared.includes('lobby'),
        `${org.slug}: servesLobby disagrees with its own brand.json`);
    }
  });

  it('gives every branch of a chain its own screen', () => {
    assert.ok(chain);
    assert.ok(chain.locations.length > 1, 'the chain under test has only one branch');
    const screens = chain.locations.map((location) => lobbyScreen(chain.slug, location.id));
    for (const screen of screens) assert.ok(screen, 'a branch resolved to no screen');
    const names = screens.map((screen) => screen?.branch.name);
    assert.equal(new Set(names).size, names.length, 'two branches share one screen');
  });

  // The failure this guards is a lobby device in one hotel showing another
  // hotel's name, address and hours -- worse than showing nothing at all.
  it('refuses a branch that belongs to a different tenant', () => {
    assert.ok(chain);
    const foreign = TENANT_ORGS.find((org) => org.slug !== chain.slug && org.locations.length > 0);
    assert.ok(foreign, 'no second tenant with a location to test against');
    assert.equal(lobbyScreen(chain.slug, foreign?.locations[0]?.id ?? ''), null);
  });

  it('refuses a tenant that declares no lobby, and an unknown slug', () => {
    const noLobby = TENANT_ORGS.find((org) => !servesLobby(org) && org.locations.length > 0);
    assert.ok(noLobby);
    assert.equal(lobbyScreen(noLobby?.slug ?? '', noLobby?.locations[0]?.id ?? ''), null);
    assert.equal(lobbyScreen('no-such-tenant', 'no-such-branch'), null);
  });

  // The section list is the partner's, not ours. Restating it here would let
  // the two drift silently; comparing them fails the moment they do.
  it('renders the published section order rather than one of its own', () => {
    assert.ok(chain);
    const screen = lobbyScreen(chain.slug, chain.locations[0]?.id ?? '');
    assert.deepEqual(
      screen?.sections.map((section) => section.id),
      lobbySectionsFor('hotel').map((section) => section.id),
    );
    assert.equal(screen?.sections.some((section) => section.id === 'claim'), false,
      'the screen asks a guest to claim the hotel they are standing in');
  });

  it('carries the branch, not the chain, as the screen identity', () => {
    assert.ok(chain);
    const second = chain.locations[1];
    const screen = lobbyScreen(chain.slug, second?.id ?? '');
    assert.equal(screen?.branch.name, second?.name);
    assert.equal(screen?.siblings.length, chain.locations.length);
    assert.ok(screen?.address.length, 'the branch rendered with no address');
  });

  /**
   * A 24-hour front desk is written as a full span in the manifest. Echoing it
   * back as `00:00-23:59` is technically true and reads, to a guest standing in
   * front of it, like a broken clock.
   */
  it('writes a round-the-clock front desk in words', () => {
    assert.ok(chain);
    const screen = lobbyScreen(chain.slug, chain.locations[0]?.id ?? '');
    assert.equal(screen?.weekly.length, 7);
    assert.ok(screen?.weekly.every((entry) => entry.span === 'Open 24 hours'),
      `expected a 24-hour desk, got ${JSON.stringify(screen?.weekly[0])}`);
  });

  /**
   * The chain ships no hand-typed Place ids on purpose: an opaque id that
   * points at the cafe next door would render the cafe's hours under the
   * hotel's name and nothing downstream would notice. A `placeQuery` is what a
   * lookup resolves instead.
   */
  it('names each property for a lookup rather than pasting an id', () => {
    assert.ok(chain);
    for (const location of chain.locations) {
      const screen = lobbyScreen(chain.slug, location.id);
      assert.ok(screen?.placeQuery, `${location.name} has nothing to resolve a listing from`);
    }
  });

  describe('surface url', () => {
    it('is path-routed on this origin, because a cross-origin frame is refused', () => {
      assert.ok(chain);
      const url = lobbySurfaceUrl(chain, '');
      assert.equal(url, `/lobby/${chain.slug}/${chain.locations[0]?.id}`);
      assert.equal(url?.startsWith('http'), false, 'the wall tile left this origin');
    });

    it('addresses the branch it was asked for', () => {
      assert.ok(chain);
      const second = chain.locations[1];
      assert.equal(lobbySurfaceUrl(chain, '', second?.id), `/lobby/${chain.slug}/${second?.id}`);
    });

    it('is null for a tenant with no lobby, so the wall keeps its own kiosk', () => {
      const noLobby = TENANT_ORGS.find((org) => !servesLobby(org));
      assert.ok(noLobby);
      assert.equal(lobbySurfaceUrl(noLobby, ''), null);
    });
  });

  it('lists a route for every branch that has a screen', () => {
    const routes = lobbyRoutes();
    const expected = lobbyTenants().reduce((total, org) => total + org.locations.length, 0);
    assert.equal(routes.length, expected);
    for (const route of routes) {
      assert.ok(lobbyScreen(route.slug, route.locationId), `${route.slug}/${route.locationId} has no screen`);
    }
  });

  // The registry and the tenant folder are two files that must agree; a chain
  // present in one and absent from the other is a demo that half works.
  it('is reachable through the console registry by slug', () => {
    assert.ok(chain);
    assert.equal(tenantOrgById(chain.id)?.slug, chain.slug);
  });
});
