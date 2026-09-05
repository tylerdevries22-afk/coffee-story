import { slugify } from '@platform/domain';

import { parseLocationDraft, type LocationValidationField } from './location-input';
import type { OrganizationKind } from './org-input';

export type OrganizationReviewDetails = {
  readonly ownerEmail: string;
  readonly location: string;
  readonly hours: string;
  readonly network: string;
  readonly territory: string;
};

export type BusinessStepField = 'name' | 'locationName' | Exclude<LocationValidationField, 'name'>;
export type BusinessStepIssue = { ok: false; error: string; field: BusinessStepField };

const valueOf = (data: FormData, key: string) => String(data.get(key) ?? '').trim();

export function businessStepOf(data: FormData):
  { ok: true; details: OrganizationReviewDetails } | BusinessStepIssue {
  const name = valueOf(data, 'name');
  if (slugify(name, 63).length < 2) {
    return { ok: false, field: 'name',
      error: 'Enter at least two letters or numbers for the organization name.' };
  }
  const kind = valueOf(data, 'organizationKind') as OrganizationKind;
  const needsLocation = kind === 'independent' || kind === 'franchisee';
  let location = '';
  let hours = '';
  if (needsLocation) {
    const parsed = parseLocationDraft({
      name: valueOf(data, 'locationName'), street: valueOf(data, 'street'),
      city: valueOf(data, 'city'), region: valueOf(data, 'region'),
      postal: valueOf(data, 'postal'), timezone: valueOf(data, 'timezone'),
      openTime: valueOf(data, 'openTime'), closeTime: valueOf(data, 'closeTime'),
      days: data.getAll('days').map(String),
    });
    if (!parsed.ok) {
      const field = parsed.field === 'name' ? 'locationName' : parsed.field;
      return { ...parsed, field };
    }
    location = [parsed.draft.name, parsed.draft.city].filter(Boolean).join(' · ');
    hours = parsed.draft.hoursSummary;
  }
  return { ok: true, details: {
    ownerEmail: valueOf(data, 'ownerEmail'), location, hours,
    network: valueOf(data, 'networkSlug'), territory: valueOf(data, 'territory'),
  } };
}
