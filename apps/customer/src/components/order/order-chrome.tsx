import {
  ActionButton, CountBadge, Ribbon, SharedCartPill, SharedRewardsBanner,
  Skeleton, StickyActionBar, STICKY_BAR_HEIGHT, useCoveringBottomInset,
  useStickyBarClearance, useTokens, type RibbonTone, AppIcon } from '@platform/ui';


export {
  ActionButton, CountBadge, Ribbon, Skeleton, StickyActionBar, STICKY_BAR_HEIGHT,
  useCoveringBottomInset, useStickyBarClearance,
};
export type { RibbonTone };

export function CartPill({ count, subtotalCents, onPress }: { count: number; subtotalCents: number; onPress: () => void }) {
  const tokens = useTokens();
  return <SharedCartPill count={count} subtotalCents={subtotalCents} onPress={onPress} icon={<AppIcon name="bag.fill" size={18} tintColor={tokens.surfaceElevated} />} />;
}

export function RewardsBanner({ label }: { label: string }) {
  const tokens = useTokens();
  return <SharedRewardsBanner label={label} mark={<AppIcon name="star.fill" size={14} tintColor={tokens.primary} />} />;
}
