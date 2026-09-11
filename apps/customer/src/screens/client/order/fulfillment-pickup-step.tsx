import * as Haptics from 'expo-haptics';
import { useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { CollapsingScreen } from '@/components/collapsing-screen';
import { Body } from '@/components/ui';
import { PICKUP_LOCATIONS } from '@/features/order/locations';
import { shopStatus } from '@/features/order/schedule';
import { TENANT } from '@/tenant';
import type { OrderFulfillment, PickupLocation } from '@platform/domain';
import { AppIcon, useTokens as useBrandTokens } from '@platform/ui';

import { createStyles } from './fulfillment-step-styles';

const SEARCH_THRESHOLD = 4;

export function PickupLocationStep({
  onBack,
  onChoose,
}: {
  onBack: () => void;
  onChoose: (fulfillment: OrderFulfillment) => void;
}) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  const [query, setQuery] = useState('');
  const searchable = PICKUP_LOCATIONS.length >= SEARCH_THRESHOLD;
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return PICKUP_LOCATIONS;
    return PICKUP_LOCATIONS.filter((office) => (
      `${office.name} ${office.address} ${office.cityLine}`.toLowerCase().includes(needle)
    ));
  }, [query]);

  return (
    <CollapsingScreen
      title="Select Pickup Location"
      onBack={onBack}
      backLabel="Order"
      keyboardShouldPersistTaps="handled"
      style={styles.page}
      headerBackgroundColor={tokens.surface}
      headerBorderColor={tokens.surface}
      contentContainerStyle={styles.content}
    >
      {searchable ? (
        <View style={styles.searchField}>
          <AppIcon name="magnifyingglass" size={18} tintColor={tokens.textMuted} />
          <TextInput
            accessibilityLabel="Search locations by city, state, or ZIP code"
            value={query}
            onChangeText={setQuery}
            placeholder="Search city, state, or ZIP"
            placeholderTextColor={tokens.textMuted}
            style={styles.searchInput}
          />
        </View>
      ) : null}

      {matches.length === 0 ? (
        <Body muted>No {TENANT.identity.name} shop matches “{query.trim()}”.</Body>
      ) : (
        matches.map((location) => (
          <LocationCard
            key={location.id}
            location={location}
            onPress={() => {
              void Haptics.selectionAsync().catch(() => undefined);
              onChoose({ mode: 'pickup', location });
            }}
          />
        ))
      )}
    </CollapsingScreen>
  );
}
function LocationCard({ location, onPress }: { location: PickupLocation; onPress: () => void }) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  const status = shopStatus(new Date());
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${location.name}, ${location.address}, ${location.cityLine}. ${status.label}.`}
      onPress={onPress}
      style={({ pressed }) => [styles.locationCard, pressed && styles.pressed]}
    >
      <View style={styles.locationMark}>
        <AppIcon name="cup.and.saucer.fill" size={20} tintColor={tokens.primary} />
      </View>
      <View style={styles.locationCopy}>
        <Text style={styles.locationName}>{location.name}</Text>
        <View style={styles.locationBadges}>
          <View style={[styles.statusBadge, status.open ? styles.statusBadgeOpen : styles.statusBadgeShut]}>
            <Text style={[styles.statusText, status.open ? styles.statusTextOpen : styles.statusTextShut]}>
              {status.label}
            </Text>
          </View>
          <Text style={styles.locationNote}>{location.note}</Text>
        </View>
        <Text style={styles.locationAddress}>{location.address}, {location.cityLine}</Text>
      </View>
      <AppIcon name="chevron.right" size={18} tintColor={tokens.textMuted} />
    </Pressable>
  );
}
