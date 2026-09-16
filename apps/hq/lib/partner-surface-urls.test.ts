import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  networkSlugOf,
  partnerAdmitsOrigin,
  partnerNetworkOf,
} from './partner-surface-urls';

/** The shipped network config, read from disk: no partner is named in source. */
function tenantNetwork(slug: string): unknown {
  return JSON.parse(
    readFileSync(join(process.cwd(), '..', '..', 'tenants', slug, 'brand.json'), 'utf8'),
  );
}

/**
 * The gate on partner-hosted surfaces.
 *
 * Two things must stay true or the wall lies to whoever opens it: a venue is
 * recognised by its NETWORK rather than by being listed here, and the kiosk is
 * never handed to a partner.
 */
describe('partner surface resolution', () => {
  // The requirement this module exists for. A venue is recognised by the
  // network its own config declares, so a hotel that joins works with no edit
  // here -- and no partner is named in this repo's source, which rule 4 forbids
  // and `pnpm audit:brand` enforces.
  it('resolves a venue it has never seen, from that venue own config', () => {
    for (const slug of ['a-hotel-nobody-listed', 'another-chain-entirely']) {
      const partner = partnerNetworkOf({
        identity: { slug },
        network: {
          slug: 'some-network', relationship: 'member',
          hostedSurfaces: { hq: 'https://partner.example/dashboard' },
          framedBy: ['https://*.vercel.app'],
        },
      });
      assert.ok(partner, `${slug} resolved to no partner`);
      assert.equal(partner?.surfaces.hq, 'https://partner.example/dashboard');
    }
  });

  it('reads the shipped network config off disk rather than a table in source', () => {
    const partner = partnerNetworkOf(tenantNetwork('actz'));
    assert.ok(partner, 'the shipped network declared no hosted surfaces');
    assert.equal(networkSlugOf(tenantNetwork('actz')), partner?.slug);
    assert.ok(partner?.surfaces.hq?.startsWith('https://'));
    assert.ok(partner?.surfaces.operator?.startsWith('https://'));
  });

  it('treats a network that hosts nothing as no partner at all', () => {
    // A franchisor that only groups brands hosts nothing; its venues keep the
    // surfaces this repo builds.
    assert.equal(partnerNetworkOf({ network: { slug: 'plain', relationship: 'owner' } }), null);
    assert.equal(partnerNetworkOf({ network: null }), null);
    assert.equal(partnerNetworkOf({}), null);
    assert.equal(partnerNetworkOf(null), null);
    assert.equal(partnerNetworkOf('not an object'), null);
  });

  it('never lets a network take the kiosk, even if its config claims it', () => {
    const partner = partnerNetworkOf({
      network: {
        slug: 'greedy', relationship: 'owner',
        hostedSurfaces: { hq: 'https://partner.example/', kiosk: 'https://partner.example/kiosk' },
      },
    });
    assert.equal(partner?.surfaces.kiosk, undefined,
      'a network claimed the kiosk, which is per-property and ours to serve');
  });

  it('ignores a hosted surface that is not an https URL', () => {
    const partner = partnerNetworkOf({
      network: {
        slug: 'sloppy', relationship: 'owner',
        hostedSurfaces: { hq: 'http://insecure.example/', operator: 'https://ok.example/' },
      },
    });
    assert.equal(partner?.surfaces.hq, undefined);
    assert.equal(partner?.surfaces.operator, 'https://ok.example/');
  });

  /**
   * Framing is the partner's decision. These encode what the network's own CSP
   * sends, so if this repo ever assumes a localhost wall can frame a deployed
   * partner, it fails here rather than painting an empty rectangle that a
   * viewer reads as a broken app.
   */
  describe('framing admission', () => {
    const partner = partnerNetworkOf(tenantNetwork('actz'));

    it('admits a deployed console on the hosted platform', () => {
      assert.ok(partner && partnerAdmitsOrigin(partner, 'https://coffee-story-hq.vercel.app'));
    });

    it('refuses a localhost wall, which is why the local tile stays blank', () => {
      assert.equal(partner && partnerAdmitsOrigin(partner, 'http://localhost:3300'), false);
      assert.equal(partner && partnerAdmitsOrigin(partner, 'https://localhost:3300'), false);
    });

    // A match that ignored the scheme or the label boundary would admit
    // `https://evilvercel.app` and `http://x.vercel.app`. Neither is the partner.
    it('does not let a lookalike origin pass as the wildcard', () => {
      assert.equal(partner && partnerAdmitsOrigin(partner, 'https://evilvercel.app'), false);
      assert.equal(partner && partnerAdmitsOrigin(partner, 'http://x.vercel.app'), false);
      assert.equal(partner && partnerAdmitsOrigin(partner, 'https://actz.org.evil.com'), false);
    });
  });
});
