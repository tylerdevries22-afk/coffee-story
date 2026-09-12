import { TENANT } from '@/tenant';

/**
 * Three industries, not two. These lists used to branch on whether a copy key
 * was set, so every tenant that was not a construction business was offered
 * "Halal-friendly food" and a barista's specialities -- including a tenant
 * declaring `generic`. A brand that belongs to no vertical gets options that
 * name no trade and no product.
 */
const GOALS: Readonly<Record<string, readonly string[]>> = {
  construction: [
    'Plan a renovation',
    'Align scope and budget',
    'Track an active project',
    'Coordinate selections',
    'Schedule warranty service',
    'Connect with my project team',
  ],
  'coffee-shop': [
    'A reliable morning coffee',
    'Somewhere to work or study',
    'Trying the signature drinks',
    'Late-night hours',
    'Halal-friendly food',
    'Catering for events',
  ],
};

const GENERIC_GOALS: readonly string[] = [
  'Getting started',
  'A recommendation',
  'Booking a time that suits me',
  'Tracking something in progress',
  'Support with an existing order',
  'Talking to the team',
];

export const CLIENT_GOAL_OPTIONS: readonly string[] =
  GOALS[TENANT.business.industryKey] ?? GENERIC_GOALS;

/** Labels for the portal API's stored `strength` values. */
export const STRENGTH_OPTIONS = ['light', 'medium', 'bold'] as const;

export function strengthLabel(value: string): string {
  switch (value) {
    case 'light': return 'Light';
    case 'medium': return 'Medium';
    case 'bold': return 'Bold';
    default: return value;
  }
}

export const PREFERRED_TIME_OPTIONS = [
  'Weekday mornings',
  'Weekday afternoons',
  'Weekday evenings',
  'Saturday',
] as const;

const SPECIALTIES: Readonly<Record<string, readonly string[]>> = {
  construction: ['Estimating', 'Project management', 'Site supervision', 'Carpentry', 'Electrical', 'Plumbing'],
  'coffee-shop': ['Espresso bar', 'Latte art', 'Matcha & tea', 'Boba', 'Pastry & bakes', 'Coffee cart catering'],
};

const GENERIC_SPECIALTIES: readonly string[] = [
  'Customer service', 'Scheduling', 'Operations', 'Training', 'Quality', 'Logistics',
];

export const STAFF_SPECIALTY_OPTIONS: readonly string[] =
  SPECIALTIES[TENANT.business.industryKey] ?? GENERIC_SPECIALTIES;

export const DAY_OPTIONS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
