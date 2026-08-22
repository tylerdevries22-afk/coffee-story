import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CollapsingScreen } from '@/components/collapsing-screen';
import { Body, Card, SectionTitle } from '@/components/ui';
import { DEMO_ADD_ONS, SERVICES, type Service } from '@/data/catalog';
import { colors, fonts, radius, spacing } from '@/theme/tokens';

/**
 * The full menu, as the website publishes it.
 *
 * The More row used to jump straight into the booking flow, so there was
 * nothing on the phone a client could browse and nothing to compare against
 * the site. Card language follows the client home screen deliberately: the two
 * screens show the same services and should not look like different studios.
 */
export function ServicesPage({
  onBack,
  onBook,
}: {
  onBack: () => void;
  onBook: (serviceId: string) => void;
}) {
  return (
    <CollapsingScreen title="Services & pricing" eyebrow="Our menu" onBack={onBack}>
      <Body muted>
        Every session, every length. Prices are the same ones published on the website.
      </Body>

      {SERVICES.map((service) => (
        <ServiceCard key={service.id} service={service} onBook={() => onBook(service.id)} />
      ))}

      <SectionTitle>Enhancements</SectionTitle>
      <Card style={styles.addOnCard}>
        {DEMO_ADD_ONS.map((addOn) => (
          <View key={addOn.slug} style={styles.addOnRow}>
            <View style={styles.addOnCopy}>
              <Text style={styles.addOnName}>{addOn.name}</Text>
              <Body muted>{addOn.description}</Body>
            </View>
            <Text style={styles.addOnPrice}>${(addOn.priceCents / 100).toFixed(0)}</Text>
          </View>
        ))}
      </Card>

      <Body muted>
        Order ahead from the Order tab and pick it up at the bar, or have it delivered.
      </Body>
    </CollapsingScreen>
  );
}

function ServiceCard({ service, onBook }: { service: Service; onBook: () => void }) {
  return (
    <Card style={styles.card}>
      <Image source={service.image} style={styles.image} contentFit="cover" alt={service.name} />
      <View style={styles.copy}>
        <Text style={styles.name}>{service.name}</Text>
        <Body muted>{service.description}</Body>
      </View>

      {/* Every length, rather than the "from" price the home screen shows --
          this is the page a client opens to compare them. */}
      <View style={styles.durations}>
        {service.durations.map((duration) => (
          <View key={duration.slug} style={styles.durationRow}>
            <Text style={styles.durationLabel}>{duration.minutes} min</Text>
            <Text style={styles.durationPrice}>${duration.price}</Text>
          </View>
        ))}
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Order ${service.name}`}
        onPress={onBook}
        style={({ pressed }) => [styles.book, pressed && styles.pressed]}
      >
        <Text style={styles.bookLabel}>Order {service.name}</Text>
      </Pressable>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm, padding: spacing.md, overflow: 'hidden' },
  image: { width: '100%', height: 132, borderRadius: radius.md },
  copy: { gap: 2 },
  name: { color: colors.ink900, fontFamily: fonts.display, fontSize: 20 },
  durations: { gap: 0 },
  durationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
    borderTopWidth: 1,
    borderTopColor: 'rgba(70,48,78,0.12)',
  },
  durationLabel: { color: colors.ink700, fontFamily: fonts.sans, fontSize: 15 },
  durationPrice: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 16 },
  book: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.brand700,
  },
  bookLabel: { color: colors.white, fontFamily: fonts.sansBold, fontSize: 15 },
  pressed: { opacity: 0.72 },
  addOnCard: { gap: spacing.sm, padding: spacing.md },
  addOnRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 56 },
  addOnCopy: { flex: 1, gap: 2 },
  addOnName: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 16 },
  addOnPrice: { color: colors.ink900, fontFamily: fonts.display, fontSize: 19 },
});
