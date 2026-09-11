import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Screen } from '@/components/ui';
import { GIFT_FAQS } from '@/data/gift-designs';
import { TENANT } from '@/tenant';
import { AppIcon, expandedState, type AppIconName, useTokens as useBrandTokens } from '@platform/ui';

import { CloseButton } from './gift-sheet-controls';
import { createGiftStyles } from './gift-shelves.styles';

const HOW_IT_WORKS: readonly { symbol: AppIconName; title: string; body: string }[] = [
  {
    symbol: 'creditcard',
    title: 'Buy a Digital Gift Card',
    body: 'Pick a design and add it to your account.',
  },
  {
    symbol: 'qrcode',
    title: 'Use Your Gift Card',
    body: 'Pay in the app or show the code at the studio.',
  },
  {
    symbol: 'paperplane',
    title: 'Send as a Gift',
    body: `Share with anyone by link — they can redeem it as a guest or add it to their ${TENANT.identity.name} account.`,
  },
];

/** The sheet behind the header's info button. */
export function GiftInfoSheet({ onClose }: { onClose: () => void }) {
  const tokens = useBrandTokens();
  const styles = createGiftStyles(tokens);
  const [openFaq, setOpenFaq] = useState<string | null>(null);
  return (
    <Screen contentContainerStyle={styles.sheetContent}>
      <View style={styles.sheetHeader}>
        <View style={styles.infoTitleGroup}>
          <Text accessibilityRole="header" style={styles.pageTitle}>
            Digital Gifting
          </Text>
          <Text style={styles.sheetBody}>Buy now, send later!</Text>
        </View>
        <CloseButton onPress={onClose} label="Close digital gifting" />
      </View>

      <ChipHeading>How it works</ChipHeading>
      {HOW_IT_WORKS.map((step) => (
        <View key={step.title} style={styles.step}>
          <AppIcon name={step.symbol} size={24} tintColor={tokens.textPrimary} />
          <View style={styles.stepCopy}>
            <Text style={styles.stepTitle}>{step.title}</Text>
            <Text style={styles.stepBody}>{step.body}</Text>
          </View>
        </View>
      ))}
      <Text style={styles.finePrint}>Digital gift card sales are final and non-refundable.</Text>

      <View style={styles.divider} />

      <ChipHeading>FAQs</ChipHeading>
      {GIFT_FAQS.map((faq) => {
        const open = openFaq === faq.question;
        return (
          <Pressable
            key={faq.question}
            accessibilityRole="button"
            {...expandedState(open)}
            onPress={() => setOpenFaq(open ? null : faq.question)}
            style={({ pressed }) => [styles.faq, pressed && styles.pressed]}
          >
            <View style={styles.faqRow}>
              <View style={styles.faqBadge}>
                <Text style={styles.faqBadgeText}>?</Text>
              </View>
              <Text style={styles.faqQuestion}>{faq.question}</Text>
              <AppIcon
                name={open ? 'chevron.down' : 'chevron.right'}
                size={15}
                tintColor={tokens.textMuted}
              />
            </View>
            {open ? <Text style={styles.faqAnswer}>{faq.answer}</Text> : null}
          </Pressable>
        );
      })}
    </Screen>
  );
}

function ChipHeading({ children }: { children: string }) {
  const tokens = useBrandTokens();
  const styles = createGiftStyles(tokens);
  return (
    <View style={styles.chipHeading}>
      <Text accessibilityRole="header" style={styles.chipHeadingText}>
        {children}
      </Text>
    </View>
  );
}
