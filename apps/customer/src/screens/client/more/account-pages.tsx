import { Text } from 'react-native';

import { CollapsingScreen } from '@/components/collapsing-screen';
import { Body, Button, Card, PillRow, SectionTitle } from '@/components/ui';
import { summarizeGiftCardOwnership } from '@/features/gifts/ownership';
import { useAuth } from '@/state/auth-context';
import { useDemo } from '@/state/demo-context';

import { openWithFeedback, useInformationStyles } from './information-page';

export function Membership({ onBack }: { onBack: () => void }) {
  const styles = useInformationStyles();
  const { portal, isDemo } = useAuth();
  const demo = useDemo();
  const membership = portal.membership;
  return (
    <CollapsingScreen title="Membership" eyebrow="Ongoing care" onBack={onBack}>
      {membership ? (
        <Card style={styles.detailCard}>
          <Text style={styles.detailTitle}>{membership.name}</Text>
          <Body>${(membership.priceCents / 100).toFixed(0)} monthly · {membership.creditsAvailable} credit available</Body>
          <Body muted>Status: {membership.status} · renews {new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(new Date(membership.renewsAt))}</Body>
          <Button
            label={membership.status === 'active' ? 'Pause membership' : 'Resume membership'}
            variant="secondary"
            onPress={() => {
              if (!isDemo) return openWithFeedback('/account/memberships');
              demo.setMembershipStatus(membership.status === 'active' ? 'paused' : 'active');
            }}
          />
        </Card>
      ) : <Card><Body muted>No active membership.</Body></Card>}
      <Button label="View membership details on web" variant="secondary" onPress={() => openWithFeedback('/account/memberships')} />
    </CollapsingScreen>
  );
}

export function Payments({ onBack }: { onBack: () => void }) {
  const styles = useInformationStyles();
  const { portal, isDemo } = useAuth();
  const demo = useDemo();
  return (
    <CollapsingScreen title="Payment methods" eyebrow="Secure checkout" onBack={onBack}>
      {(portal.paymentMethods ?? []).map((method) => (
        <Card key={method.id} style={styles.detailCard}>
          <Text style={styles.detailTitle}>{method.brand} •••• {method.last4}</Text>
          <Body muted>Expires {method.expirationMonth}/{method.expirationYear}{method.isDefault ? ' · Default' : ''}</Body>
          {isDemo ? <Button label="Remove demo card" variant="secondary" onPress={() => demo.removePaymentMethod(method.id)} /> : null}
        </Card>
      ))}
      {!portal.paymentMethods?.length ? <Card><Body muted>No saved methods. A card can be saved during secure checkout.</Body></Card> : null}
      {!isDemo ? <Button label="Manage securely on web" onPress={() => openWithFeedback('/account/profile#payment-method')} /> : null}
    </CollapsingScreen>
  );
}

export function GiftBalance({ onBack, onBook }: { onBack: () => void; onBook: () => void }) {
  const styles = useInformationStyles();
  const { portal } = useAuth();
  const giftSummary = summarizeGiftCardOwnership(portal.giftCards);
  return (
    <CollapsingScreen title="Gift card balance" eyebrow="Stored value" onBack={onBack}>
      <Card style={styles.detailCard}>
        <Body muted>Available to spend</Body>
        <Text style={styles.balance}>${(giftSummary.spendableBalanceCents / 100).toFixed(2)}</Text>
      </Card>
      <SectionTitle>My claimed cards</SectionTitle>
      {giftSummary.spendableCards.map((gift) => <PillRow key={gift.id} title={gift.code} subtitle={`$${(gift.balanceCents / 100).toFixed(2)} · ${gift.status}`} symbol="gift" />)}
      {!giftSummary.spendableCards.length ? <Card><Body muted>No claimed gift cards are available.</Body></Card> : null}
      <SectionTitle>Gifts I sent</SectionTitle>
      {giftSummary.sentCards.map((gift) => <PillRow key={gift.id} title={gift.recipientName || gift.recipientEmail || 'Recipient'} subtitle={`$${(gift.initialCents / 100).toFixed(2)} · ${gift.status}`} symbol="gift" />)}
      {!giftSummary.sentCards.length ? <Card><Body muted>No sent gifts yet.</Body></Card> : null}
      <Button label="Book with a gift card" onPress={onBook} />
    </CollapsingScreen>
  );
}
