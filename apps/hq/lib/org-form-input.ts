/**
 * The new-organization form, read into the parsers' input shapes.
 *
 * One reader for both places that need it -- the server action, and the
 * wizard's own check before it submits -- so a field added to the form cannot
 * reach one of them and quietly miss the other. Every value is read as the
 * string the form posted; trimming and validation belong to the parsers.
 */
import type { LocationInput } from './location-input';
import type { OrgInput } from './org-input';

function text(data: FormData, key: string): string {
  const value = data.get(key);
  return typeof value === 'string' ? value : '';
}

export function locationInputFromForm(data: FormData): LocationInput {
  return {
    name: text(data, 'locationName'), street: text(data, 'street'),
    city: text(data, 'city'), region: text(data, 'region'),
    postal: text(data, 'postal'), timezone: text(data, 'timezone'),
    openTime: text(data, 'openTime'), closeTime: text(data, 'closeTime'),
    days: data.getAll('days').map(String),
    // Per-day spans from the wizard's hours editor, as JSON. Absent, the
    // quick form above is the location's hours.
    hours: text(data, 'hours'),
    googlePlaceId: text(data, 'googlePlaceId'),
    lat: text(data, 'lat'), lng: text(data, 'lng'),
    phone: text(data, 'phone'),
    // The business's site is the first location's too: the wizard asks once.
    website: text(data, 'website'),
  };
}

export function orgInputFromForm(data: FormData): OrgInput {
  return {
    name: text(data, 'name'), ownerEmail: text(data, 'ownerEmail'),
    organizationKind: text(data, 'organizationKind'),
    industryKey: text(data, 'industryKey'), blueprintKey: text(data, 'blueprintKey'),
    networkSlug: text(data, 'networkSlug'), territory: text(data, 'territory'),
    website: text(data, 'website'),
    moduleKeys: data.getAll('moduleKeys').map(String),
    connectorIds: data.getAll('connectorIds').map(String),
    location: locationInputFromForm(data),
  };
}
