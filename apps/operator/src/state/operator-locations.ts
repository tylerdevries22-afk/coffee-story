import { SELECTED_DEMO_TENANT } from '@/data/demo-tenant';

export type OperatorLocation = { id: string; name: string; timezone: string };

/** Multi-location demo roster; a single-location brand just never shows the picker. */
export const DEMO_LOCATIONS: readonly OperatorLocation[] = [
  // Districts, not one tenant's street. The operator app is a single listing
  // signed into by every brand, so demo copy naming a real address showed one
  // franchisee's location to all the others.
  { id: 'loc-uptown', name: 'Uptown', timezone: 'America/Denver' },
  { id: 'loc-downtown', name: 'Downtown', timezone: 'America/Denver' },
];

export const TENANT_DEMO_LOCATIONS = SELECTED_DEMO_TENANT?.locations ?? DEMO_LOCATIONS;

export const DEFAULT_DEMO_LOCATION: OperatorLocation = TENANT_DEMO_LOCATIONS[0] ?? {
  id: 'demo-location',
  name: 'Demo location',
  timezone: 'America/Denver',
};
