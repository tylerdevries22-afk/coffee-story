import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { CollapsingScreen } from '@/components/collapsing-screen';
import { Body, Button, Card, SectionTitle } from '@/components/ui';
import { TENANT } from '@/tenant';
import { choiceState, useTokens as useBrandTokens } from '@platform/ui';

import { createGiftScreenStyles } from './gift-screen.styles';

const AMOUNTS = [50, 75, 100, 150, 200] as const;

type PurchaseProps = {
  amount: number;
  recipientName: string;
  recipient: string;
  message: string;
  delivery: 'now' | 'week';
  loading: boolean;
  setAmount: (amount: number) => void;
  setRecipientName: (name: string) => void;
  setRecipient: (email: string) => void;
  setMessage: (message: string) => void;
  setDelivery: (delivery: 'now' | 'week') => void;
  onBack: () => void;
  onPay: () => void;
};

export function Purchase({ amount, recipientName, recipient, message, delivery, loading, setAmount, setRecipientName, setRecipient, setMessage, setDelivery, onBack, onPay }: PurchaseProps) {
  const tokens = useBrandTokens();
  const styles = createGiftScreenStyles(tokens);
  return (
    <CollapsingScreen title="Send a digital gift" eyebrow="Gift cards" onBack={onBack} backLabel="Gift cards" keyboardShouldPersistTaps="handled">
      <View style={styles.preview}><LinearGradient colors={[tokens.secondary, tokens.primary]} style={StyleSheet.absoluteFill} /><Text style={styles.previewMark}>{TENANT.identity.name}</Text><Text style={styles.previewAmount}>${amount}</Text></View>
      <SectionTitle>Choose an amount</SectionTitle>
      <View accessibilityRole="radiogroup" style={styles.amounts}>{AMOUNTS.map((value) => (
        <Pressable
          key={value}
          accessibilityRole="radio"
          {...choiceState(amount === value)}
          onPress={() => setAmount(value)}
          style={({ pressed }) => [styles.amount, amount === value && styles.amountActive, pressed && styles.pressed]}
        >
          <Text style={[styles.amountText, amount === value && styles.amountTextActive]}>${value}</Text>
        </Pressable>
      ))}</View>
      <GiftField label="Recipient name" value={recipientName} onChangeText={setRecipientName} placeholder="Jordan" />
      <GiftField label="Recipient email" value={recipient} onChangeText={setRecipient} keyboardType="email-address" placeholder="friend@example.com" />
      <GiftField label="A note from you" value={message} onChangeText={setMessage} placeholder="A little time, just for you." multiline />
      <SectionTitle>Delivery</SectionTitle>
      <View accessibilityRole="radiogroup" style={styles.amounts}>
        <Pressable accessibilityRole="radio" {...choiceState(delivery === 'now')} onPress={() => setDelivery('now')} style={({ pressed }) => [styles.deliveryChoice, delivery === 'now' && styles.amountActive, pressed && styles.pressed]}><Text style={[styles.amountText, delivery === 'now' && styles.amountTextActive]}>Send after payment</Text></Pressable>
        <Pressable accessibilityRole="radio" {...choiceState(delivery === 'week')} onPress={() => setDelivery('week')} style={({ pressed }) => [styles.deliveryChoice, delivery === 'week' && styles.amountActive, pressed && styles.pressed]}><Text style={[styles.amountText, delivery === 'week' && styles.amountTextActive]}>Deliver in 1 week</Text></Pressable>
      </View>
      <Card style={styles.legal}><Body muted>Digital gift card sales are final. Funds never expire. A secure claim link is emailed after payment.</Body></Card>
      <Button label={`Pay $${amount} securely`} loading={loading} onPress={onPay} />
    </CollapsingScreen>
  );
}

export function GiftField({ label, ...props }: React.ComponentProps<typeof TextInput> & { label: string }) {
  const tokens = useBrandTokens();
  const styles = createGiftScreenStyles(tokens);
  return <View style={styles.field}><Text style={styles.fieldLabel}>{label}</Text><TextInput accessibilityLabel={`${label} input`} {...props} placeholderTextColor={tokens.textMuted} style={[styles.input, props.multiline && styles.multiline]} /></View>;
}
