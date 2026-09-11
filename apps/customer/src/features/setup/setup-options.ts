import { TENANT } from '@/tenant';

const IS_PROJECT_BUSINESS = Boolean(TENANT.copy.projectName);

export const CLIENT_GOAL_OPTIONS: readonly string[] = IS_PROJECT_BUSINESS
  ? [
      'Plan a renovation',
      'Align scope and budget',
      'Track an active project',
      'Coordinate selections',
      'Schedule warranty service',
      'Connect with my project team',
    ]
  : [
      'A reliable morning coffee',
      'Somewhere to work or study',
      'Trying the signature drinks',
      'Late-night hours',
      'Halal-friendly food',
      'Catering for events',
    ];

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

export const STAFF_SPECIALTY_OPTIONS: readonly string[] = IS_PROJECT_BUSINESS
  ? ['Estimating', 'Project management', 'Site supervision', 'Carpentry', 'Electrical', 'Plumbing']
  : ['Espresso bar', 'Latte art', 'Matcha & tea', 'Boba', 'Pastry & bakes', 'Coffee cart catering'];

export const DAY_OPTIONS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
