import { useMemo } from 'react';

import { type FeedVoice } from '@platform/domain';
import { useCopy } from '@platform/ui';

import { BUSINESS } from '@/data/business';

/**
 * The shop's own name and its word for points, for the feed.
 *
 * Both call sites -- the notifications route and the More screen -- build the
 * same feed, and a row reading "Coffee Story" in one and "The shop" in the
 * other would be a visible seam. One hook so they cannot diverge.
 *
 * `pointsName` goes through `useCopy` rather than the raw dictionary because
 * that is the accessor that falls back to a real word when a tenant has not
 * set the key, instead of to `undefined`.
 *
 * Memoised because both callers pass the result into a `useMemo` that rebuilds
 * the whole feed: a fresh object every render would make that memo a no-op.
 */
export function useFeedVoice(): FeedVoice {
  const pointsName = useCopy()('pointsName');
  return useMemo(() => ({ brandName: BUSINESS.name, pointsName }), [pointsName]);
}
