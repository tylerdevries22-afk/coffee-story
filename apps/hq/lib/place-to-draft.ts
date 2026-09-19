/**
 * One Google listing as the new-organization wizard's draft.
 *
 * Everything here is a suggestion an operator reviews before anything is
 * created, so the mapping is conservative. A value that would fail the form's
 * own validation is left empty rather than half-filled -- a prefilled field
 * that then refuses to submit reads as the operator's mistake -- and anything
 * worth a second look comes back as a warning instead of being silently
 * corrected or silently kept: a closed business, a website that was not https,
 * a listing with no hours.
 *
 * Shaped for the browser: the route answers with this and nothing else, so no
 * photo reference, rating or review link leaves the server just because the
 * lookup happened to return it.
 */
import type { PlaceDetails } from '@platform/engine';

import { phoneOf, websiteFromGoogle } from './location-contact';
import type { HoursByDay } from './location-hours';
import { hoursFromPeriods } from './place-hours';
import { suggestIndustry, type IndustrySuggestion } from './place-industry';

export type PlaceWarningCode =
  | 'closed_permanently' | 'closed_temporarily' | 'website_upgraded' | 'website_dropped' | 'no_hours';

export type PlaceWarning = { readonly code: PlaceWarningCode; readonly message: string };

export type PlaceDraft = {
  readonly googlePlaceId: string;
  readonly name: string;
  readonly street: string | null;
  readonly city: string | null;
  readonly region: string | null;
  readonly postal: string | null;
  readonly timezone: string | null;
  readonly phone: string | null;
  readonly website: string | null;
  readonly lat: number | null;
  readonly lng: number | null;
  /** Null when Google has no machine-readable hours, so the form keeps its own. */
  readonly hours: HoursByDay | null;
  readonly industry: IndustrySuggestion;
  readonly warnings: readonly PlaceWarning[];
};

/** The form fields' own limits, so a prefilled value always fits where it lands. */
const LIMIT = { name: 120, street: 160, city: 120, region: 80, postal: 24 } as const;

function fits(value: string | null, max: number): string | null {
  return value !== null && value.length <= max ? value : null;
}

function warningsFor(place: PlaceDetails, website: ReturnType<typeof websiteFromGoogle>,
  hours: HoursByDay | null): PlaceWarning[] {
  const warnings: PlaceWarning[] = [];
  if (place.businessStatus === 'CLOSED_PERMANENTLY') {
    warnings.push({ code: 'closed_permanently',
      message: 'Google marks this business as permanently closed. Make sure it is the right listing before using its details.' });
  } else if (place.businessStatus === 'CLOSED_TEMPORARILY') {
    warnings.push({ code: 'closed_temporarily', message: 'Google marks this business as temporarily closed.' });
  }
  if (website.note === 'upgraded') {
    warnings.push({ code: 'website_upgraded',
      message: `Google lists ${place.websiteUri ?? 'the website'} without https, so it was switched to https. Check that it loads.` });
  } else if (website.note === 'dropped') {
    warnings.push({ code: 'website_dropped',
      message: 'Google’s website link is not a public https address, so it was left out.' });
  }
  if (hours === null) {
    warnings.push({ code: 'no_hours', message: 'Google has no opening hours for this business. Enter them by hand.' });
  }
  return warnings;
}

export function placeToDraft(place: PlaceDetails): PlaceDraft {
  const website = websiteFromGoogle(place.websiteUri);
  const phone = phoneOf(place.phone);
  const hours = hoursFromPeriods(place.openingPeriods);
  return {
    googlePlaceId: place.placeId,
    name: place.name.slice(0, LIMIT.name).trim(),
    street: fits(place.address.street, LIMIT.street),
    city: fits(place.address.city, LIMIT.city),
    region: fits(place.address.region, LIMIT.region),
    postal: fits(place.address.postal, LIMIT.postal),
    timezone: place.timeZone,
    phone: phone.ok ? phone.value : null,
    website: website.value,
    lat: place.location?.lat ?? null,
    lng: place.location?.lng ?? null,
    hours,
    industry: suggestIndustry(place),
    warnings: warningsFor(place, website, hours),
  };
}
