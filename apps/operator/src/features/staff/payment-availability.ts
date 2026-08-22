export type StaffTenderKey =
  | 'card'
  | 'square'
  | 'tap'
  | 'cash'
  | 'check'
  | 'gift'
  | 'credit'
  | 'onfile';

const LIVE_PROVIDER_TENDERS: ReadonlySet<StaffTenderKey> = new Set([
  'card',
]);

/** Only the generic secure card sheet currently has a complete live settlement path. */
export function isStaffTenderAvailable(tender: StaffTenderKey, isDemo: boolean): boolean {
  return isDemo || LIVE_PROVIDER_TENDERS.has(tender);
}
