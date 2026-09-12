import { useMemo } from 'react';
import { Alert, Share, Text, View } from 'react-native';

import { CollapsingScreen } from '@/components/collapsing-screen';
import { MenuImage } from '@/components/menu-image';
import { Body, Button, Card } from '@/components/ui';
import { BUSINESS } from '@/data/business';
import { CATERING_UNAVAILABLE_MESSAGE, cateringEmailHref, cateringPhoneHref } from '@/features/catering-request';
import { dropArchive, dropStatus, type Drop } from '@/features/drops';
import { REFERRAL_SHARE_EXPLAINER, referralCodeFor, referralIncomingMessage } from '@/features/referrals';
import { openContactLink } from '@/lib/contact-links';
import { clearPendingReferralCode, readPendingReferralCode } from '@/state/pending-referral';
import { findMenuItem } from '@/screens/client/order/menu-data';
import { useAuth } from '@/state/auth-context';
import { useAppState } from '@/state/app-context';
import { useCustomerCatalog } from '@/state/catalog-context';
import { TENANT, tenantFeature } from '@/tenant';
import { DropCountdown, useCopy, useTokens as useBrandTokens } from '@platform/ui';

import { useInformationStyles } from './information-page';

import { createPlatformPageStyles } from './platform-page.styles';

export function DropsArchive({ onBack }: { onBack: () => void }) {
  const { setClientTab } = useAppState();
  const { drops: catalogDrops } = useCustomerCatalog();
  const drops = useMemo(() => dropArchive(catalogDrops, new Date()), [catalogDrops]);
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
  const pageStyles = useInformationStyles();
  const tokens = useBrandTokens();
  const local = createPlatformPageStyles(tokens);
  const { items } = useCustomerCatalog();
  const item = findMenuItem(items, drop.itemId);
  const live = dropStatus(drop, new Date()) === 'live';
  return (
    <Card style={pageStyles.detailCard}>
      <View style={local.dropRow}>
        {item ? <MenuImage source={item.image} variant="tile" alt="" /> : null}
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

/**
 * There is no catering-request intake (see features/catering-request.ts): no
 * endpoint, no table, nothing that notifies the shop. This used to collect an
 * event date, party size, and notes, then flip to a fake success card on
 * tap -- a lie, since nothing was ever sent anywhere. The honest version
 * points the guest at a channel that actually reaches the shop.
 */
export function CateringRequest({ onBack }: { onBack: () => void }) {
  const pageStyles = useInformationStyles();

  if (!tenantFeature('catering')) {
    return (
      <CollapsingScreen title="Catering" onBack={onBack}>
        <Card><Body muted>Catering is not offered here yet.</Body></Card>
      </CollapsingScreen>
    );
  }

  function openOrAlert(url: string, failureTitle: string) {
    void openContactLink(url).catch((error: unknown) => {
      Alert.alert(failureTitle, error instanceof Error ? error.message : 'Try again later.');
    });
  }

  return (
    <CollapsingScreen title="Catering" eyebrow="For your event" onBack={onBack}>
      <Body muted>
        Carafes, pastry boxes, and a barista if you want one. {BUSINESS.name}
        puts together catering quotes by phone or email, not through the app.
      </Body>
      <Card style={pageStyles.detailCard}>
        <Text style={pageStyles.detailTitle}>Get in touch</Text>
        <Body>{CATERING_UNAVAILABLE_MESSAGE}</Body>
        <Button
          label={`Call ${BUSINESS.phone}`}
          onPress={() => openOrAlert(cateringPhoneHref(BUSINESS.phone), 'Could not open phone')}
        />
        <Button
          label={`Email ${BUSINESS.email}`}
          variant="secondary"
          onPress={() => openOrAlert(cateringEmailHref(BUSINESS.email), 'Could not open email')}
        />
      </Card>
    </CollapsingScreen>
  );
}

export function Referrals({ onBack }: { onBack: () => void }) {
  const pageStyles = useInformationStyles();
  const tokens = useBrandTokens();
  const local = createPlatformPageStyles(tokens);
  const { portal } = useAuth();
  const copy = useCopy();

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
          <Body>{referralIncomingMessage(incoming)}</Body>
          <Button label="Got it" variant="secondary" onPress={clearPendingReferralCode} />
        </Card>
      ) : null}
      <Card style={pageStyles.detailCard}>
        <Text style={local.codeLabel}>Your code</Text>
        <Text accessibilityRole="text" selectable style={local.code}>{code}</Text>
        <Body muted>{REFERRAL_SHARE_EXPLAINER}</Body>
        <Button
          label="Share your code"
          onPress={() => {
            void Share.share({
              message: copy('referralShare', {
                appName: TENANT.identity.name,
                code,
                url: BUSINESS.website,
              }),
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
