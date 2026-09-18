import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  coordinatesOf, phoneOf, placeIdOf, websiteFromGoogle, websiteFromInput,
} from './location-contact';

describe('a website from Google', () => {
  it('keeps an https site as it is', () => {
    assert.deepEqual(websiteFromGoogle('https://harbor-roast.example.com/menu'),
      { value: 'https://harbor-roast.example.com/menu', note: null });
  });

  it('moves an http site to https, and says so', () => {
    // The factory's run row admits https only, and dropping these would send
    // research off with no site at all.
    assert.deepEqual(websiteFromGoogle('http://harbor-roast.example.com/'),
      { value: 'https://harbor-roast.example.com/', note: 'upgraded' });
  });

  it('leaves out anything that is not a public web address, and says so', () => {
    for (const uri of ['ftp://files.example.com/', 'javascript:alert(1)', 'http://localhost:3000/',
      'https://192.168.1.10/', 'https://user:pass@harbor.example.com/', 'not a url']) {
      assert.deepEqual(websiteFromGoogle(uri), { value: null, note: 'dropped' }, uri);
    }
  });

  it('is simply absent when the listing names none', () => {
    assert.deepEqual(websiteFromGoogle(null), { value: null, note: null });
    assert.deepEqual(websiteFromGoogle('  '), { value: null, note: null });
  });
});

describe('a website someone typed', () => {
  it('is public https or nothing, never upgraded behind their back', () => {
    assert.deepEqual(websiteFromInput(' https://harbor.example.com '), { ok: true, value: 'https://harbor.example.com' });
    assert.deepEqual(websiteFromInput(''), { ok: true, value: null });
    assert.deepEqual(websiteFromInput(undefined), { ok: true, value: null });
    for (const typed of ['http://harbor.example.com', 'harbor.example.com', 'https://10.0.0.8/',
      `https://harbor.example.com/${'a'.repeat(2_100)}`]) {
      assert.equal(websiteFromInput(typed).ok, false, typed.slice(0, 40));
    }
  });
});

describe('a phone number', () => {
  it('accepts the ways numbers are written, from 7 to 15 digits', () => {
    for (const phone of ['+1 303-555-0100', '(303) 555-0100', '303.555.0100', '555-0100', '+44 20 7946 0958']) {
      assert.deepEqual(phoneOf(phone), { ok: true, value: phone });
    }
    assert.deepEqual(phoneOf('  '), { ok: true, value: null });
    assert.deepEqual(phoneOf(null), { ok: true, value: null });
  });

  it('refuses letters, too few digits and too many', () => {
    for (const phone of ['call us', '555-010', '+1 303 555 0100 ext 4', '1234567890123456']) {
      assert.equal(phoneOf(phone).ok, false, phone);
    }
  });
});

describe('a Google Place id', () => {
  it('has the shape the locations column enforces', () => {
    assert.deepEqual(placeIdOf('ChIJExample_Place-01'), { ok: true, value: 'ChIJExample_Place-01' });
    assert.deepEqual(placeIdOf(''), { ok: true, value: null });
    for (const id of ['short', 'has space in it', 'semi;colon', 'x'.repeat(256)]) {
      assert.equal(placeIdOf(id).ok, false, id.slice(0, 20));
    }
  });
});

describe('a map position', () => {
  it('is both coordinates or neither', () => {
    assert.deepEqual(coordinatesOf('39.7061', '-105.6969'), { ok: true, value: { lat: 39.7061, lng: -105.6969 } });
    assert.deepEqual(coordinatesOf(39.7061, -105.6969), { ok: true, value: { lat: 39.7061, lng: -105.6969 } });
    assert.deepEqual(coordinatesOf('', ''), { ok: true, value: null });
    assert.deepEqual(coordinatesOf(undefined, undefined), { ok: true, value: null });
  });

  it('never reads an empty field as zero, which would put the location on the equator', () => {
    assert.equal(coordinatesOf('39.7', '').ok, false);
    assert.equal(coordinatesOf('', '-105.7').ok, false);
  });

  it('refuses a position off the globe or not a number', () => {
    for (const [lat, lng] of [['90.5', '0'], ['0', '-181'], ['north', '0'], ['Infinity', '0']] as const) {
      assert.equal(coordinatesOf(lat, lng).ok, false, `${lat},${lng}`);
    }
  });
});
