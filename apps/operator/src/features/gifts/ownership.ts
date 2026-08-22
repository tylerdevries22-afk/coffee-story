import type { GiftCard } from '@/types/domain';

export type GiftCardOwnershipSummary = {
  spendableCards: GiftCard[];
  sentCards: GiftCard[];
  spendableBalanceCents: number;
  sentBalanceCents: number;
};

export function summarizeGiftCardOwnership(giftCards: readonly GiftCard[]): GiftCardOwnershipSummary {
  const spendableCards = giftCards.filter((gift) => gift.claimedByCurrentUser === true);
  const sentCards = giftCards.filter((gift) => gift.purchasedByCurrentUser === true);
  return {
    spendableCards,
    sentCards,
    spendableBalanceCents: spendableCards.reduce((total, gift) => total + gift.balanceCents, 0),
    sentBalanceCents: sentCards.reduce((total, gift) => total + gift.balanceCents, 0),
  };
}
