import type { BrandRole } from '@platform/schema';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ASSIGNABLE_ROLES = ['brand_owner', 'location_manager', 'staff'] as const;

export type AssignableStaffRole = Extract<BrandRole, (typeof ASSIGNABLE_ROLES)[number]>;

export type StaffDraft = {
  email: string;
  locationIds: string[];
  role: AssignableStaffRole;
};

export type StaffDraftResult =
  | { ok: true; draft: StaffDraft }
  | { ok: false; error: string };

export function parseStaffDraft(input: {
  email: unknown;
  locationIds: readonly unknown[];
  role: unknown;
}): StaffDraftResult {
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
  if (email.length < 3 || email.length > 254 || !EMAIL.test(email)) {
    return { ok: false, error: 'Enter a valid staff email address.' };
  }
  if (typeof input.role !== 'string' || !ASSIGNABLE_ROLES.includes(input.role as AssignableStaffRole)) {
    return { ok: false, error: 'Choose an assignable staff role.' };
  }
  const role = input.role as AssignableStaffRole;
  const locationIds = [...new Set(input.locationIds.filter(
    (value): value is string => typeof value === 'string' && UUID.test(value),
  ))];
  if (locationIds.length !== input.locationIds.length || locationIds.length > 100) {
    return { ok: false, error: 'The location scope is invalid.' };
  }
  if (role !== 'brand_owner' && locationIds.length === 0) {
    return { ok: false, error: 'Managers and staff need at least one location.' };
  }
  return { ok: true, draft: { email, role, locationIds: role === 'brand_owner' ? [] : locationIds } };
}
