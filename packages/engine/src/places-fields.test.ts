import assert from 'node:assert/strict';
import test from 'node:test';

import { address, businessStatus, httpsUri, openingPeriods, timeZoneId } from './places-fields';
import { HOTEL } from './places.test-support';
import { PLACE_FIELDS, normalizePlace } from './places-types';

// A snapshot on purpose. Google bills a Details call at the costliest field in
// its mask, so widening this list is a pricing decision and should show up in
// review as a one-line diff here, not slip in beside a type change.
test('the Details field mask is exactly the reviewed list', () => {
  assert.deepEqual(PLACE_FIELDS, [
    'id', 'displayName', 'formattedAddress', 'addressComponents', 'location', 'timeZone',
    'rating', 'userRatingCount', 'websiteUri', 'internationalPhoneNumber', 'nationalPhoneNumber',
    'regularOpeningHours.weekdayDescriptions', 'regularOpeningHours.periods', 'photos.name',
    'types', 'primaryType', 'businessStatus', 'googleMapsUri',
    'googleMapsLinks.reviewsUri', 'googleMapsLinks.writeAReviewUri',
  ]);
  assert.equal(new Set(PLACE_FIELDS).size, PLACE_FIELDS.length, 'a field is requested twice');
});

test('normalizePlace reads everything the wizard fills from', () => {
  const place = normalizePlace(HOTEL);
  assert.ok(place);
  assert.deepEqual(place.address, {
    street: '1 Example Street', city: 'Georgetown', region: 'CO', postal: '80444', country: 'US',
  });
  assert.equal(place.timeZone, 'America/Denver');
  assert.equal(place.primaryType, 'hotel');
  assert.equal(place.businessStatus, 'OPERATIONAL');
  assert.deepEqual(place.openingPeriods, [{ openDay: 0, open: '00:00', closeDay: null, close: null }]);
  assert.equal(place.mapsUri, 'https://maps.google.com/?cid=1');
  assert.equal(place.reviewsUri, HOTEL.googleMapsLinks.reviewsUri);
  assert.equal(place.writeReviewUri, HOTEL.googleMapsLinks.writeAReviewUri);
});

test('openingPeriods keeps overnight spans and per-day hours', () => {
  const periods = openingPeriods([
    { open: { day: 1, hour: 7 }, close: { day: 1, hour: 15, minute: 30 } },
    // Friday evening into Saturday morning: the close is on the next day.
    { open: { day: 5, hour: 18 }, close: { day: 6, hour: 2 } },
  ]);
  assert.deepEqual(periods, [
    { openDay: 1, open: '07:00', closeDay: 1, close: '15:30' },
    { openDay: 5, open: '18:00', closeDay: 6, close: '02:00' },
  ]);
});

test('openingPeriods drops a span it cannot read rather than guessing one', () => {
  const periods = openingPeriods([
    { open: { day: 7, hour: 9 } },
    { open: { day: 1, hour: 25 } },
    { open: { day: 1, hour: 9.5 } },
    { open: { day: 1, hour: 24, minute: 30 } },
    { open: { day: 1, hour: '9' } },
    // A close that is present but unreadable is not "open around the clock".
    { open: { day: 2, hour: 9 }, close: { day: 2, hour: 99 } },
    'Monday 9-5',
    { close: { day: 3, hour: 17 } },
  ]);
  assert.deepEqual(periods, []);
  assert.deepEqual(openingPeriods(undefined), []);
});

test('address falls back through the city types other countries use', () => {
  const london = address([
    { longText: '10', types: ['street_number'] },
    { longText: 'Example Road', types: ['route'] },
    { longText: 'London', shortText: 'London', types: ['postal_town'] },
    { longText: 'England', shortText: 'England', types: ['administrative_area_level_1', 'political'] },
    { longText: 'United Kingdom', shortText: 'GB', types: ['country', 'political'] },
  ]);
  assert.equal(london.city, 'London');
  assert.equal(london.country, 'GB');
  assert.equal(london.street, '10 Example Road');
});

test('address leaves out what the listing does not have', () => {
  const routeOnly = address([{ longText: 'County Road 12', types: ['route'] }, 'junk', { types: ['locality'] }]);
  assert.deepEqual(routeOnly, { street: 'County Road 12', city: null, region: null, postal: null, country: null });
  assert.deepEqual(address(null), { street: null, city: null, region: null, postal: null, country: null });
});

test('timeZoneId accepts only a zone this runtime can use', () => {
  assert.equal(timeZoneId({ id: 'America/Denver', version: '2025a' }), 'America/Denver');
  assert.equal(timeZoneId({ id: 'Mars/Olympus_Mons' }), null);
  assert.equal(timeZoneId('America/Denver'), null, 'a bare string is not the TimeZone message');
});

// These links are drawn as buttons, so anything but https is refused.
test('httpsUri refuses a link that is not https', () => {
  assert.equal(httpsUri('https://maps.google.com/?cid=1'), 'https://maps.google.com/?cid=1');
  for (const unsafe of ['http://maps.google.com/', 'javascript:alert(1)', 'not a url', 7, null]) {
    assert.equal(httpsUri(unsafe), null, String(unsafe));
  }
});

test('businessStatus knows only the three states that mean something', () => {
  assert.equal(businessStatus('CLOSED_PERMANENTLY'), 'CLOSED_PERMANENTLY');
  assert.equal(businessStatus('BUSINESS_STATUS_UNSPECIFIED'), null);
  assert.equal(businessStatus(undefined), null);
});
