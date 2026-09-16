import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  PARTNER_NETWORKS,
  networkSlugOf,
  partnerAdmitsOrigin,
  partnerNetworkFor,
} from './partner-surface-urls';

/**
 * The gate on partner-hosted surfaces.
 *
 * Two things must stay true or the wall lies to whoever opens it: a venue is
 * recognised by its NETWORK rather than by being listed here, and the kiosk is
 * never handed to a partner.
 */
describe('partner surface resolution', () => {
  it('recognises a venue by the network its config declares', () => {
    const partner = partnerNetworkFor(networkSlugOf({
      network: { slug: 'actz', relationship: 'member' },
    }));
    assert.ok(partner, 'a venue on the actz network resolved to no partner');
    assert.equal(partner?.surfaces.hq, 'https://actz.org/dashboard');
  });

  // The requirement this file exists for. A hotel that joins the network must
  // work with no edit here; if this ever fails, "any property" has quietly
  // become "the properties someone remembered to list".
  it('resolves a venue it has never seen, because the network is the key', () => {
    for (const slug of ['a-hotel-nobody-listed', 'another-chain-entirely']) {
      const partner = partnerNetworkFor(networkSlugOf({
        identity: { slug }, network: { slug: 'actz', relationship: 'member' },
      }));
      assert.ok(partner, `${slug} resolved to no partner`);
    }
  });

  it('leaves a tenant on no network entirely alone', () => {
    assert.equal(partnerNetworkFor(networkSlugOf({ network: null })), null);
    assert.equal(partnerNetworkFor(networkSlugOf({})), null);
    assert.equal(partnerNetworkFor(networkSlugOf(null)), null);
    assert.equal(partnerNetworkFor(networkSlugOf('not an object')), null);
  });

  it('never hands the kiosk to a partner', () => {
    for (const [name, partner] of Object.entries(PARTNER_NETWORKS)) {
      assert.equal(partner.surfaces.kiosk, undefined,
        `${name} claimed the kiosk, which is per-property and ours to serve`);
    }
  });

  /**
   * Framing is the partner's decision. These assertions encode what actz-may's
   * security-csp.ts actually sends, so if this repo ever assumes a localhost
   * wall can frame production Actz, it fails here rather than painting an empty
   * rectangle that reads as a broken app.
   */
  describe('framing admission', () => {
    const actz = PARTNER_NETWORKS.actz;

    it('admits a deployed HQ on the hosted platform', () => {
      assert.ok(actz && partnerAdmitsOrigin(actz, 'https://coffee-story-hq.vercel.app'));
      assert.ok(actz && partnerAdmitsOrigin(actz, 'https://actz.org'));
    });

    it('refuses a localhost wall, which is why the local tile stays blank', () => {
      assert.equal(actz && partnerAdmitsOrigin(actz, 'http://localhost:3300'), false);
      assert.equal(actz && partnerAdmitsOrigin(actz, 'https://localhost:3300'), false);
    });

    // A suffix match that ignored the scheme or the label boundary would admit
    // `https://evil-vercel.app` and `http://…vercel.app`. Neither is the partner.
    it('does not let a lookalike origin pass as the wildcard', () => {
      assert.equal(actz && partnerAdmitsOrigin(actz, 'https://evilvercel.app'), false);
      assert.equal(actz && partnerAdmitsOrigin(actz, 'http://x.vercel.app'), false);
      assert.equal(actz && partnerAdmitsOrigin(actz, 'https://actz.org.evil.com'), false);
    });
  });
});
