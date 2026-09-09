import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { CollapsingScreen } from '@/components/collapsing-screen';
import { Body, Button, Eyebrow, PillRow, Screen, Title } from '@/components/ui';
import { BUSINESS, BUSINESS_MONOGRAM } from '@/data/business';
import { mobileApi } from '@/lib/mobile-api';
import { useAuth } from '@/state/auth-context';
import { useDemo } from '@/state/demo-context';
import { TENANT } from '@/tenant';
import type { GiftCard } from '@platform/domain';
import { useTokens as useBrandTokens } from '@platform/ui';

import { GiftField as Field } from './gift-purchase';
import { createGiftScreenStyles } from './gift-screen.styles';

export function RecipientExperience({ initialToken, isDemo, onBook, onBack }: { initialToken: string; isDemo: boolean; onBook: () => void; onBack: () => void }) {
  const tokens = useBrandTokens();
  const styles = createGiftScreenStyles(tokens);
  const { portal, refresh } = useAuth();
  const demo = useDemo();
  const [token, setToken] = useState(initialToken);
  const [claimed, setClaimed] = useState<{ code: string; balanceCents: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [claimRequestKey] = useState(
    () => `claim-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`,
  );
  const isAdded = claimed
    ? portal.giftCards.some((gift) => gift.code === claimed.code)
    : false;

  function addClaimedGift() {
    if (!claimed || isAdded) return;
    if (!isDemo) return;
    demo.addGift({
      code: claimed.code,
      initialCents: claimed.balanceCents,
      balanceCents: claimed.balanceCents,
      recipientEmail: portal.profile.email,
      recipientName: portal.profile.fullName,
      designKey: 'guest-gift',
      deliveryAt: null,
      status: 'claimed',
      claimedByCurrentUser: true,
      purchasedByCurrentUser: false,
    });
    Alert.alert('Gift added', 'This gift is now available in My gift cards.');
  }

  async function claim() {
    if (token.trim().length < 32) {
      setError('Paste the full secure token from your gift link.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      if (isDemo) {
        setClaimed({ code: `${BUSINESS.giftCodePrefix}-GUEST-DEMO`, balanceCents: 6000 });
        return;
      }
      const result = await mobileApi.claimGift(token.trim(), claimRequestKey);
      await refresh();
      setClaimed({ code: result.code, balanceCents: result.balanceCents });
    } catch (claimError) {
      setError(claimError instanceof Error ? claimError.message : 'This gift could not be claimed.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <CollapsingScreen
      title={claimed ? 'Your gift is ready' : 'A gift for you'}
      eyebrow="Guest gift access"
      onBack={onBack}
      backLabel="Gift cards"
    >
      <View style={styles.preview}><LinearGradient colors={[tokens.accent, tokens.primary]} style={StyleSheet.absoluteFill} /><Text style={styles.previewMark}>{TENANT.identity.name}</Text><Text style={styles.previewAmount}>{claimed ? `$${(claimed.balanceCents / 100).toFixed(0)}` : 'A gift'}</Text></View>
      {claimed ? (
        <>
          <PillRow title={claimed.code} subtitle={`$${(claimed.balanceCents / 100).toFixed(2)} available · never expires`} symbol="creditcard" />
          <Button label="Order as a guest" onPress={onBook} />
          {isDemo ? (
            <Button
              label={isAdded ? 'Added to my account' : 'Add to my account'}
              variant="secondary"
              disabled={isAdded}
              onPress={addClaimedGift}
            />
          ) : isAdded ? (
            <Button label="Added to my account" variant="secondary" disabled onPress={() => undefined} />
          ) : (
            <Body muted>Gift accepted. It will appear in your account after the secure claim finishes syncing.</Body>
          )}
        </>
      ) : (
        <>
          <Field label="Secure gift token" value={token} onChangeText={setToken} autoCapitalize="none" placeholder="Paste the token from your email" />
          {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
          <Button label="Accept this gift" loading={loading} onPress={() => void claim()} />
        </>
      )}
    </CollapsingScreen>
  );
}

export function GiftDetail({ gift, onBook, onBack }: { gift: GiftCard; onBook: () => void; onBack: () => void }) {
  const tokens = useBrandTokens();
  const styles = createGiftScreenStyles(tokens);
  return (
    <CollapsingScreen title={gift.recipientName || 'A gift of care'} eyebrow="My gift card" onBack={onBack} backLabel="Gift cards">
      <View style={styles.preview}>
        <LinearGradient colors={[tokens.secondary, tokens.primary]} style={StyleSheet.absoluteFill} />
        <Text style={styles.previewMark}>{gift.code}</Text>
        <Text style={styles.previewAmount}>${(gift.balanceCents / 100).toFixed(0)}</Text>
      </View>
      <PillRow title="Available balance" subtitle={`$${(gift.balanceCents / 100).toFixed(2)} · ${gift.status}`} symbol="creditcard" />
      {gift.recipientEmail ? <PillRow title="Recipient" subtitle={gift.recipientEmail} symbol="message" /> : null}
      <Button label="Order with this gift" onPress={onBook} />
    </CollapsingScreen>
  );
}

export function SentScreen({ amount, recipient, isDemo, onReset }: { amount: number; recipient: string; isDemo: boolean; onReset: () => void }) {
  const tokens = useBrandTokens();
  const styles = createGiftScreenStyles(tokens);
  return (
    <Screen contentContainerStyle={styles.sent}>
      <View style={styles.sentMark}><Text style={styles.sentMarkText}>{BUSINESS_MONOGRAM}</Text></View>
      <Eyebrow>Gift sent</Eyebrow>
      <Title>${amount} of care is on its way.</Title>
      <Body muted>{isDemo ? `Preview complete for ${recipient}; no email or payment was sent.` : `A secure gift link will be delivered to ${recipient}.`}</Body>
      <Button label="Send another gift" onPress={onReset} />
    </Screen>
  );
}
