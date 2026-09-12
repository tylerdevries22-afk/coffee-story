import type { GiftCard, RewardEntry } from '@platform/domain';

import { CONSTRUCTION_ORDER_SEEDS, constructionMessages } from '../construction-demo';
import type { DemoSeedSet } from './types';

/**
 * Construction's demo fixtures, wired into the shared seed-set shape.
 *
 * The seed content stays in `construction-demo.ts` unchanged -- the project
 * screens read it directly, and the change-request/draw/document previews
 * there are not part of the portal bundle this registry assembles. This file
 * only maps the order seeds and messages onto `DemoSeedSet` so `demo.ts` can
 * select construction the same way it selects coffee and the neutral pack.
 */
export const CONSTRUCTION_SEEDS: DemoSeedSet = {
  orderSeeds: CONSTRUCTION_ORDER_SEEDS,
  rewardLedger: (): RewardEntry[] => [],
  rewardActivities: [],
  rewardCatalog: [],
  giftCards: (): GiftCard[] => [],
  messages: constructionMessages,
  preferenceNotes:
    'Preferred contact: email. Access window is 8 AM–4 PM; coordinate trade arrivals with the superintendent.',
  membershipName: 'Project Care',
};
