import type { RewardEntry } from '@platform/domain';

type IsoAt = (daysFromNow: number, hour: number, minute?: number) => string;

export function createDemoRewardLedger(isoAt: IsoAt): RewardEntry[] {
  return [
  { id: 'ledger-01', entryType: 'purchase', points: 91, description: 'Honeycomb Cheese Bread', earnedAt: isoAt(-6, 19), expiresAt: isoAt(359, 19) },
  { id: 'ledger-02', entryType: 'purchase', points: 84, description: 'Pistachio Latte (16 oz)', earnedAt: isoAt(-14, 11), expiresAt: isoAt(351, 11) },
  { id: 'ledger-03', entryType: 'activity', points: 10, description: 'set your usual order', earnedAt: isoAt(-20, 9), expiresAt: isoAt(345, 9) },
  { id: 'ledger-04', entryType: 'purchase', points: 96, description: 'Spanish Latte (20 oz)', earnedAt: isoAt(-21, 9), expiresAt: isoAt(344, 9) },
  { id: 'ledger-05', entryType: 'redemption', points: -500, description: 'Redeemed $5 drink credit', earnedAt: isoAt(-24, 12), expiresAt: null },
  { id: 'ledger-06', entryType: 'purchase', points: 120, description: 'Mochi Donut Trio', earnedAt: isoAt(-32, 13), expiresAt: isoAt(333, 13) },
  { id: 'ledger-07', entryType: 'activity', points: 5, description: 'add birthday', earnedAt: isoAt(-38, 8), expiresAt: isoAt(327, 8) },
  { id: 'ledger-08', entryType: 'purchase', points: 84, description: 'Pistachio Milk Cake', earnedAt: isoAt(-45, 20), expiresAt: isoAt(320, 20) },
  { id: 'ledger-09', entryType: 'purchase', points: 84, description: 'Brown Sugar Boba (20 oz)', earnedAt: isoAt(-60, 14), expiresAt: isoAt(305, 14) },
  { id: 'ledger-10', entryType: 'purchase', points: 84, description: 'Spanish Latte (16 oz)', earnedAt: isoAt(-74, 11), expiresAt: isoAt(291, 11) },
  { id: 'ledger-11', entryType: 'purchase', points: 72, description: 'Adeni Chai (16 oz)', earnedAt: isoAt(-90, 10), expiresAt: isoAt(275, 10) },
  { id: 'ledger-12', entryType: 'purchase', points: 84, description: 'Rooh Afza Boba (20 oz)', earnedAt: isoAt(-112, 13), expiresAt: isoAt(253, 13) },
  { id: 'ledger-13', entryType: 'expiration', points: -40, description: 'Expired Beans', earnedAt: isoAt(-120, 0), expiresAt: null },
  { id: 'ledger-14', entryType: 'purchase', points: 72, description: 'Sunset Sparkling Ade (20 oz)', earnedAt: isoAt(-135, 16), expiresAt: isoAt(230, 16) },
  { id: 'ledger-15', entryType: 'purchase', points: 72, description: 'Spanish Latte (12 oz)', earnedAt: isoAt(-160, 9), expiresAt: isoAt(205, 9) },
  { id: 'ledger-16', entryType: 'purchase', points: 84, description: 'Turkish Coffee (Double)', earnedAt: isoAt(-182, 11), expiresAt: isoAt(183, 11) },
  { id: 'ledger-17', entryType: 'purchase', points: 84, description: 'Pistachio Latte (16 oz)', earnedAt: isoAt(-210, 14), expiresAt: isoAt(155, 14) },
  { id: 'ledger-18', entryType: 'purchase', points: 70, description: 'Spanish Latte (16 oz)', earnedAt: isoAt(-400, 10), expiresAt: isoAt(-35, 10) },
  ];
}
