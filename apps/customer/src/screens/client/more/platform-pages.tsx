/**
 * The platform-model pages behind More: the drop archive, catering requests,
 * and referrals. Feature-flagged per tenant (rule 5); the More screen only
 * offers the rows whose flags are on, and a deep link to a disabled page
 * lands on its empty state rather than a crash.
 */
import { useMemo, useState } from 'react';
import { Image, Share, StyleSheet, Text, TextInput, View } from 'react-native';

import { CollapsingScreen } from '@/components/collapsing-screen';
import { Body, Button, Card } from '@/components/ui';
import { demoDrops } from '@/data/drops';
import { BUSINESS } from '@/data/business';
import { dropArchive, dropStatus, type Drop } from '@/features/drops';
import { referralCodeFor, referralMessage } from '@/features/referrals';
import { clearPendingReferralCode, readPendingReferralCode } from '@/state/pending-referral';
import { findMenuItem } from '@/screens/client/order/menu-data';
import { useAuth } from '@/state/auth-context';
import { useAppState } from '@/state/app-context';
import { TENANT, tenantFeature } from '@/tenant';
import { colors, fonts, radius, spacing } from '@/theme/tokens';
import { DropCountdown } from '@platform/ui';

import { styles as pageStyles } from './information-page';

export function DropsArchive({ onBack }: { onBack: () => void }) {
  const { setClientTab } = useAppState();
  const drops = useMemo(() => dropArchive(demoDrops(), new Date()), []);
  return (
    <CollapsingScreen title="Drops" eyebrow="Limited runs" onBack={onBack}>
      <Body muted>
        One special drink at a time, gone when it is gone. The current drop is
        on the home screen; everything that already ran lives here.
      </Body>
      {drops.length === 0 ? (
        <Card><Body muted>No drops have run yet.</Body></Card>
      ) : drops.map((drop) => <DropRow key={drop.id} drop={drop} onOrder={() => setClientTab('book')} />)}
    </CollapsingScreen>
  );
}

function DropRow({ drop, onOrder }: { drop: Drop; onOrder: () => void }) {
  const item = findMenuItem(drop.itemId);
  const live = dropStatus(drop, new Date()) === 'live';
  return (
    <Card style={pageStyles.detailCard}>
      <View style={local.dropRow}>
        {item ? <Image source={item.image} style={local.dropImage} accessibilityIgnoresInvertColors /> : null}
        <View style={local.dropBody}>
          <Text style={pageStyles.detailTitle}>{drop.title}</Text>
          <Body muted>{drop.blurb}</Body>
          {live ? (
            <DropCountdown startsAt={new Date(drop.startsAt)} endsAt={new Date(drop.endsAt)} />
          ) : (
            <Text style={local.endedLabel}>
              Ran {new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(drop.startsAt))}
              {' – '}
              {new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(drop.endsAt))}
            </Text>
          )}
        </View>
      </View>
      {live ? <Button label="Order it while it lasts" onPress={onOrder} /> : null}
    </Card>
  );
}

export function CateringRequest({ onBack }: { onBack: () => void }) {
  const { portal } = useAuth();
  const [eventDate, setEventDate] = useState('');
  const [partySize, setPartySize] = useState('');
  const [notes, setNotes] = useState('');
  const [sent, setSent] = useState(false);

  if (!tenantFeature('catering')) {
    return (
      <CollapsingScreen title="Catering" onBack={onBack}>
        <Card><Body muted>Catering is not offered here yet.</Body></Card>
      </CollapsingScreen>
    );
  }

  const canSend = eventDate.trim().length > 0 && partySize.trim().length > 0;
  return (
    <CollapsingScreen title="Catering" eyebrow="For your event" onBack={onBack}>
      {sent ? (
        <Card style={pageStyles.detailCard}>
          <Text style={pageStyles.detailTitle}>Request received</Text>
          <Body>
            Thanks {portal.profile.fullName || 'there'} — the shop will reply in
            Messages within one business day.
          </Body>
          <Button label="Done" variant="secondary" onPress={onBack} />
        </Card>
      ) : (
        <>
          <Body muted>
            Carafes, pastry boxes, and a barista if you want one. Tell us about
            the event and {BUSINESS.name} will follow up with a quote.
          </Body>
          <Card style={pageStyles.detailCard}>
            <Text style={local.fieldLabel}>Event date</Text>
            <TextInput
              accessibilityLabel="Event date"
              value={eventDate}
              onChangeText={setEventDate}
              placeholder="Sat Sep 12, morning"
              placeholderTextColor={colors.ink400}
              style={local.field}
            />
            <Text style={local.fieldLabel}>How many people</Text>
            <TextInput
              accessibilityLabel="How many people"
              value={partySize}
              onChangeText={setPartySize}
              placeholder="25"
              keyboardType="number-pad"
              placeholderTextColor={colors.ink400}
              style={local.field}
            />
            <Text style={local.fieldLabel}>Anything else</Text>
            <TextInput
              accessibilityLabel="Anything else"
              value={notes}
              onChangeText={setNotes}
              placeholder="Dietary needs, delivery or pickup, timing"
              placeholderTextColor={colors.ink400}
              multiline
              style={[local.field, local.fieldTall]}
            />
            <Button label="Send request" disabled={!canSend} onPress={() => setSent(true)} />
          </Card>
        </>
      )}
    </CollapsingScreen>
  );
}

export function Referrals({ onBack }: { onBack: () => void }) {
  const { portal } = useAuth();

  if (!tenantFeature('referrals')) {
    return (
      <CollapsingScreen title="Refer a friend" onBack={onBack}>
        <Card><Body muted>Referrals are not running here yet.</Body></Card>
      </CollapsingScreen>
    );
  }

  const code = referralCodeFor(portal.profile.fullName || 'Friend', BUSINESS.giftCodePrefix);
  const incoming = readPendingReferralCode();
  return (
    <CollapsingScreen title="Refer a friend" eyebrow="Share the good stuff" onBack={onBack}>
      {incoming ? (
        <Card style={pageStyles.detailCard}>
          <Text style={pageStyles.detailTitle}>Friend code received</Text>
          <Body>
            Code {incoming} will be applied to your first order. Nothing else to
            do -- just order something good.
          </Body>
          <Button label="Got it" variant="secondary" onPress={clearPendingReferralCode} />
        </Card>
      ) : null}
      <Card style={pageStyles.detailCard}>
        <Text style={local.codeLabel}>Your code</Text>
        <Text accessibilityRole="text" selectable style={local.code}>{code}</Text>
        <Body muted>
          When a friend places their first order with your code, you each get a
          free drink loaded onto your rewards.
        </Body>
        <Button
          label="Share your code"
          onPress={() => {
            void Share.share({
              message: referralMessage(code, TENANT.identity.name, BUSINESS.website),
            }).catch(() => undefined);
          }}
        />
      </Card>
      <Card>
        <Body muted>
          One reward per friend, first order only. The barista can apply a code
          at the register too.
        </Body>
      </Card>
    </CollapsingScreen>
  );
}

const local = StyleSheet.create({
  dropRow: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
  dropImage: { width: 72, height: 72, borderRadius: radius.md, backgroundColor: colors.brand100 },
  dropBody: { flex: 1, gap: spacing.xs },
  endedLabel: { color: colors.ink500, fontFamily: fonts.sansMedium, fontSize: 13 },
  fieldLabel: { color: colors.ink700, fontFamily: fonts.sansMedium, fontSize: 13 },
  field: {
    borderWidth: 1,
    borderColor: colors.ink200,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.ink900,
    fontFamily: fonts.sans,
    fontSize: 15,
    backgroundColor: colors.white,
  },
  fieldTall: { minHeight: 88, textAlignVertical: 'top' },
  codeLabel: { color: colors.ink500, fontFamily: fonts.sansMedium, fontSize: 13 },
  code: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 24, letterSpacing: 1 },
});
