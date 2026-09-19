import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseTenantManifest } from '@platform/tenant-config';

import { demoLanding } from '../demo-pack';
import { placeToDraft } from '../place-to-draft';
import type { DemoBrandKit } from './kit';
import { buildDemoPack } from './pack-builder';
import { CAFE } from './runner.test-support';

const KIT: DemoBrandKit = {
  colors: ['#0B2545', '#1B998B'],
  tagline: 'Waterfront coffee.',
  email: 'hello@harborroast.example',
  logo: 'logo.webp',
  menu: [
    { name: 'Latte', description: 'Steamed milk.', priceCents: 525, category: 'Coffee', image: 'latte.webp' },
    { name: 'Mocha', description: null, priceCents: 575, category: 'Coffee', image: null },
    { name: 'Scone', description: null, priceCents: 350, category: 'Bakery', image: null },
  ],
};

function build(kit: DemoBrandKit | null, place = CAFE) {
  return buildDemoPack({ place, draft: placeToDraft(place), kit });
}

describe('buildDemoPack', () => {
  it('builds what the wizard would build for this business, with its listing on it', () => {
    const built = build(null);
    assert.ok(built.ok);
    const { pack } = built;
    assert.equal(parseTenantManifest(pack.brand).kind === 'invalid', false, 'the brand manifest is valid');
    const business = pack.brand.business as Record<string, unknown>;
    assert.equal(business.phone, '+1 303-555-0100');
    assert.equal(business.website, 'https://www.harborroast.example/');
    assert.equal(business.email, '', 'no invented owner address reaches the page');
    assert.deepEqual(pack.listing, {
      mapsUri: CAFE.mapsUri, reviewsUri: CAFE.reviewsUri, weekdayDescriptions: CAFE.weekdayDescriptions,
    });
    assert.equal(built.draft.industryKey, 'coffee-shop');
    assert.ok(built.draft.modules.some((module) => module.key === 'commerce-catalog'));
  });

  it('stands a labelled sample menu in when the website gave none', () => {
    const built = build(null);
    assert.ok(built.ok);
    assert.equal(built.pack.menuSource, 'sample');
    assert.ok(built.pack.menu.items.length > 0);
    const landing = demoLanding(built.pack, 'fallback');
    assert.equal(landing.name, 'Harbor Roast');
    assert.equal(landing.menuSample, true);
    assert.ok(landing.menu.length > 0, 'the landing page draws the sample');
  });

  it('lays the website kit over the listing: its menu, colors, tagline, contact and logo', () => {
    const built = build(KIT);
    assert.ok(built.ok);
    const { pack } = built;
    assert.equal(pack.menuSource, 'website');
    assert.deepEqual(pack.menu.items.map((item) => item.id), ['latte', 'mocha', 'scone']);
    assert.deepEqual(pack.media, { logo: 'logo.webp', items: { latte: 'latte.webp' } });
    const tokens = pack.brand.tokens as Record<string, unknown>;
    assert.equal(tokens.primary, '#0b2545');
    assert.equal(tokens.accent, '#1b998b');
    const business = pack.brand.business as Record<string, unknown>;
    assert.equal(business.tagline, 'Waterfront coffee.');
    assert.equal(business.email, 'hello@harborroast.example');
    assert.equal(demoLanding(pack, 'fallback').menuSample, false);
  });

  it('builds nothing for a listing without hours or a time zone, rather than guess them', () => {
    assert.deepEqual(build(null, { ...CAFE, openingPeriods: [] }), { ok: false, reason: 'incomplete_listing' });
    assert.deepEqual(build(null, { ...CAFE, timeZone: null }), { ok: false, reason: 'incomplete_listing' });
  });

  it('refuses a listing the organization parser would refuse', () => {
    assert.deepEqual(build(null, { ...CAFE, name: '!' }), { ok: false, reason: 'invalid_listing' });
  });

  it('keeps a logo name the media route would not serve out of the pack', () => {
    const built = build({ ...KIT, logo: '../../secret.png' });
    assert.ok(built.ok);
    assert.equal(built.pack.media.logo, null);
  });
});
