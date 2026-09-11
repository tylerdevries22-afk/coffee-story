import { Body, Button, Card, PillRow, SectionTitle } from '@/components/ui';
import { CollapsingScreen } from '@/components/collapsing-screen';
import type { GiftCard } from '@platform/domain';

export function GiftWallet({
  gifts,
  onOpen,
  onBuy,
  onBack,
}: {
  gifts: GiftCard[];
  onOpen: (gift: GiftCard) => void;
  onBuy: () => void;
  onBack: () => void;
}) {
  const received = gifts.filter((gift) => gift.claimedByCurrentUser);
  const sent = gifts.filter((gift) => gift.purchasedByCurrentUser);
  return (
    <CollapsingScreen title="My gift cards" eyebrow="Stored value" onBack={onBack} backLabel="Gift cards">
      <Body muted>Open a card to see its balance and continue into booking.</Body>
      <SectionTitle>Received</SectionTitle>
      {received.map((gift) => (
        <PillRow
          key={gift.id}
          title={gift.code}
          subtitle={`$${(gift.balanceCents / 100).toFixed(2)} · ${gift.status}`}
          symbol="creditcard"
          onPress={() => onOpen(gift)}
        />
      ))}
      {!received.length ? <Card><Body muted>No received gift cards yet.</Body></Card> : null}
      <SectionTitle>Sent</SectionTitle>
      {sent.map((gift) => (
        <PillRow
          key={gift.id}
          title={gift.recipientName || gift.recipientEmail || 'Recipient'}
          subtitle={`$${(gift.initialCents / 100).toFixed(2)} · ${gift.status}`}
          symbol="gift"
          onPress={() => onOpen(gift)}
        />
      ))}
      {!sent.length ? <Card><Body muted>No sent gifts yet.</Body></Card> : null}
      <Button label="Buy another gift card" onPress={onBuy} />
    </CollapsingScreen>
  );
}
