import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { BUSINESS, businessFromBrandConfig, DEMO_BUSINESS, resolveBusiness } from './business';

/** The shape `scripts/onboard.ts` actually writes into `brands.brand_config`. */
const ROASTERY_CONFIG = {
  identity: { slug: 'demo-roastery', scheme: 'demoroastery' },
  tokens: { primary: '#2F2A26' },
  copy: { appName: 'Demo Roastery', pointsName: 'Beans' },
  business: {
    legalName: 'Demo Roastery LLC',
    tagline: 'Roasted this morning',
    email: 'hello@demoroastery.example',
    phone: '(303) 555-0143',
    website: 'https://demoroastery.example',
    giftCodePrefix: 'DR',
    monogram: 'DR',
  },
};

const DOWNTOWN = { street: '100 Main St', city: 'Denver', region: 'CO', postal: '80202' };

describe('businessFromBrandConfig', () => {
  it('resolves the signed-in brand, not the bundled one', () => {
    const business = businessFromBrandConfig(ROASTERY_CONFIG, 'Demo Roastery', DOWNTOWN);
    assert.equal(business.name, 'Demo Roastery');
    assert.equal(business.legalName, 'Demo Roastery LLC');
    assert.equal(business.email, 'hello@demoroastery.example');
    assert.equal(business.phone, '(303) 555-0143');
    assert.equal(business.website, 'https://demoroastery.example');
    assert.equal(business.monogram, 'DR');
    assert.equal(business.giftCodePrefix, 'DR');
    assert.equal(business.street, '100 Main St');
    assert.equal(business.cityLine, 'Denver, CO 80202');
  });

  it('never leaks the bundled tenant into another brand', () => {
    // The whole point: one listing serves every tenant, so no field may fall
    // back to Coffee Story's. A brand that has posted nothing shows nothing.
    const business = businessFromBrandConfig({}, 'Demo Roastery', null);
    for (const value of [business.email, business.phone, business.website, business.street, business.cityLine]) {
      assert.equal(value, '');
    }
    assert.notEqual(business.name, BUSINESS.name);
    assert.notEqual(business.monogram, 'CS');
  });

  it('takes the shop name from the brands row, which brand_config has no column for', () => {
    // The old version looked for business.name / business.street /
    // business.cityLine -- keys no tenant file has ever written -- so all
    // three could only ever return Coffee Story's.
    assert.equal(businessFromBrandConfig(ROASTERY_CONFIG, 'Renamed Roastery', null).name, 'Renamed Roastery');
    // brands.name is the source; copy.appName is the fallback when it is blank.
    assert.equal(businessFromBrandConfig(ROASTERY_CONFIG, '   ', null).name, 'Demo Roastery');
    assert.equal(businessFromBrandConfig(ROASTERY_CONFIG, null, null).name, 'Demo Roastery');
  });

  it('derives a mark and a gift prefix for a brand that set neither', () => {
    const business = businessFromBrandConfig({ copy: { appName: 'Blue Bottle Works' } }, null, null);
    assert.equal(business.monogram, 'BBW');
    assert.equal(business.giftCodePrefix, 'BBW');
  });

  it('claims no identity at all before the brand row lands', () => {
    // The window between sign-in and loadStaffContext resolving, and the state
    // after a failed load. Answering "Coffee Story" there is the same leak.
    const unknown = businessFromBrandConfig(null, null, null);
    assert.deepEqual(unknown, {
      name: '', legalName: '', tagline: '', email: '', phone: '',
      street: '', cityLine: '', website: '', giftCodePrefix: '', monogram: '',
    });
  });

  it('survives a null, malformed, or hostile brand_config', () => {
    for (const config of [null, undefined, 'not an object', 42, [], { business: null }, { business: { email: 7 } }]) {
      const business = businessFromBrandConfig(config, 'Some Shop', null);
      assert.equal(business.name, 'Some Shop');
      assert.equal(business.email, '');
    }
  });

  it('builds a city line from whatever parts the location posted', () => {
    assert.equal(businessFromBrandConfig({}, 'S', { city: 'Denver', region: 'CO' }).cityLine, 'Denver, CO');
    assert.equal(businessFromBrandConfig({}, 'S', { city: 'Denver' }).cityLine, 'Denver');
    assert.equal(businessFromBrandConfig({}, 'S', { postal: '80202' }).cityLine, '80202');
    assert.equal(businessFromBrandConfig({}, 'S', {}).cityLine, '');
  });
});

describe('resolveBusiness', () => {
  it('keeps the bundled shop in demo mode, which is Coffee Story', () => {
    const business = resolveBusiness({
      isDemo: true, brandConfig: ROASTERY_CONFIG, brandName: 'Demo Roastery', address: DOWNTOWN,
    });
    assert.deepEqual(business, DEMO_BUSINESS);
    assert.equal(business.name, 'Coffee Story');
  });

  it('resolves the brand row in live mode', () => {
    const business = resolveBusiness({
      isDemo: false, brandConfig: ROASTERY_CONFIG, brandName: 'Demo Roastery', address: DOWNTOWN,
    });
    assert.equal(business.name, 'Demo Roastery');
    assert.equal(business.website, 'https://demoroastery.example');
  });
});
