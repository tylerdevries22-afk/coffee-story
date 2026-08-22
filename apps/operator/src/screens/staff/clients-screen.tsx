import { useMemo, useState } from 'react';
import { Animated, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  Avatar,
  ChipRow,
  EmptyState,
  MoneyText,
  SourceBadge,
  StatTile,
  StatusBadge,
  WorkspaceCard,
} from '@/components/staff/workspace-ui';
import { CollapsingPageHeader } from '@/components/collapsing-page-header';
import { CollapsingScreen } from '@/components/collapsing-screen';
import { PillRow, Screen } from '@/components/ui';
import { soapNotesForClient } from '@/features/staff/dashboard';
import { CLIENT_TAGS, filterClients, formatMoney, type ClientTag } from '@/features/staff/workspace';
import { useAppState } from '@/state/app-context';
import { colors, fonts, radius, spacing } from '@/theme/tokens';
import type { StaffClient, StaffDashboard, StaffPayment, StaffSoapNote } from '@/types/domain';
import { tabState } from '@/lib/a11y-state';

/** Detail tabs, in the same order the web admin client record uses. */
const CLIENT_DETAIL_TABS = ['Details', 'Activity', 'Notes', 'Account', 'Order Notes'] as const;
type ClientDetailTab = (typeof CLIENT_DETAIL_TABS)[number];

export function ClientsScreen({ dashboard }: { dashboard: StaffDashboard }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = dashboard.clients.find((client) => client.id === selectedId);

  if (selected) {
    return <ClientDetail dashboard={dashboard} client={selected} onBack={() => setSelectedId(null)} />;
  }
  return <ClientList dashboard={dashboard} onSelect={setSelectedId} />;
}

function ClientList({
  dashboard,
  onSelect,
}: {
  dashboard: StaffDashboard;
  onSelect: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState<ClientTag | null>(null);
  const [scrollY] = useState(() => new Animated.Value(0));
  const clients = useMemo(
    () => filterClients(dashboard.clients, query, tag),
    [dashboard.clients, query, tag],
  );

  return (
    <Screen
      stickyHeaderIndices={[0]}
      contentContainerStyle={{ paddingTop: 0 }}
      onScroll={(event) => scrollY.setValue(event.nativeEvent.contentOffset.y)}
      scrollEventThrottle={16}
    >
      <CollapsingPageHeader title="Guests" scrollY={scrollY} />
      <Text style={styles.subtitle}>{`${dashboard.clients.length} clients on file`}</Text>
      <TextInput
        accessibilityLabel="Search guests by name or email"
        value={query}
        onChangeText={setQuery}
        placeholder="Search by name or email…"
        placeholderTextColor={colors.ink400}
        autoCorrect={false}
        style={styles.search}
      />
      <ChipRow options={CLIENT_TAGS} value={tag} onChange={setTag} allLabel="All" />
      {clients.length ? (
        <WorkspaceCard title="Directory">
          <View style={styles.tableHeader}>
            <Text style={styles.tableHeaderText}>Client</Text>
            <Text style={[styles.tableHeaderText, styles.tableHeaderRight]}>Spend</Text>
          </View>
          {clients.map((client) => (
            <Pressable
              key={client.id}
              accessibilityRole="button"
              accessibilityLabel={`${client.fullName}, ${formatMoney(client.lifetimeSpendCents ?? 0)} lifetime spend`}
              onPress={() => onSelect(client.id)}
              style={({ pressed }) => [styles.clientRow, pressed && styles.pressed]}
            >
              <Avatar name={client.fullName} />
              <View style={styles.clientCopy}>
                <Text style={styles.clientName} numberOfLines={1}>{client.fullName}</Text>
                <Text style={styles.clientEmail} numberOfLines={1}>{client.email}</Text>
              </View>
              <View style={styles.spendCell}>
                <MoneyText cents={client.lifetimeSpendCents ?? 0} />
              </View>
            </Pressable>
          ))}
        </WorkspaceCard>
      ) : (
        <EmptyState title="No guests" message="No clients match your search." />
      )}
    </Screen>
  );
}

function ClientDetail({
  dashboard,
  client,
  onBack,
}: {
  dashboard: StaffDashboard;
  client: StaffClient;
  onBack: () => void;
}) {
  const { setStaffTab } = useAppState();
  const [tab, setTab] = useState<ClientDetailTab>('Details');
  const notes = useMemo(() => soapNotesForClient(dashboard, client.id), [dashboard, client.id]);
  const visits = useMemo(
    () => dashboard.appointments
      .filter((appointment) => appointment.clientName === client.fullName)
      .sort((a, b) => b.startsAt.localeCompare(a.startsAt)),
    [dashboard.appointments, client.fullName],
  );
  const payments = useMemo(
    () => (dashboard.recentPayments ?? []).filter((payment) => payment.clientName === client.fullName),
    [dashboard.recentPayments, client.fullName],
  );
  const tags = client.tags ?? [];

  return (
    <CollapsingScreen title={client.fullName} eyebrow="Guest profile" onBack={onBack} backLabel="Clients">
      <View style={styles.detailHeader}>
        <Avatar name={client.fullName} size={56} />
        <View style={styles.detailHeaderCopy}>
          <Text style={styles.subtitle}>
            {`${client.completedVisits} visits · ${formatMoney(client.lifetimeSpendCents ?? 0)} lifetime`}
          </Text>
        </View>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tabStrip}
      >
        {CLIENT_DETAIL_TABS.map((option) => (
          <Pressable
            key={option}
            accessibilityRole="tab"
            accessibilityLabel={`${option} tab`}
            {...tabState(option === tab)}
            onPress={() => setTab(option)}
            style={({ pressed }) => [styles.tab, option === tab && styles.tabActive, pressed && styles.pressed]}
          >
            <Text style={[styles.tabText, option === tab && styles.tabTextActive]}>{option}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {tab === 'Details' ? (
        <>
          <WorkspaceCard title="Details">
            <LabelledRow label="Email" value={client.email} />
            <LabelledRow label="Phone" value={client.phone ?? 'No phone saved'} />
            <LabelledRow
              label="Last visit"
              value={client.lastVisitAt ? formatDate(client.lastVisitAt) : 'No visits yet'}
            />
            <LabelledRow label="Completed orders" value={String(client.completedVisits)} />
          </WorkspaceCard>
          <WorkspaceCard title="Tags">
            {tags.length ? (
              <View style={styles.tagWrap}>
                {tags.map((label) => <SourceBadge key={label} label={label} />)}
              </View>
            ) : <Text style={styles.muted}>No tags yet</Text>}
          </WorkspaceCard>
        </>
      ) : null}

      {tab === 'Activity' ? (
        visits.length ? (
          <WorkspaceCard title="Order history">
            {visits.map((visit) => (
              <View key={visit.id} style={styles.entryRow}>
                <View style={styles.entryCopy}>
                  <Text style={styles.entryTitle}>{visit.serviceName}</Text>
                  <Text style={styles.entryMeta}>{formatDate(visit.startsAt)}</Text>
                </View>
                <StatusBadge status={visit.status} />
              </View>
            ))}
          </WorkspaceCard>
        ) : <EmptyState title="Order history" message="No visits on record yet." />
      ) : null}

      {tab === 'Notes' ? (
        notes.length ? (
          <WorkspaceCard title="Care notes">
            {notes.map((note) => (
              <View key={note.id} style={styles.entryCopy}>
                <Text style={styles.entryTitle}>{note.serviceName}</Text>
                <Text style={styles.entryMeta}>{`Plan: ${note.plan}`}</Text>
              </View>
            ))}
          </WorkspaceCard>
        ) : <EmptyState title="Care notes" message="No care notes yet." />
      ) : null}

      {tab === 'Account' ? (
        <>
          <View style={styles.statRow}>
            <StatTile label="Lifetime spend" value={formatMoney(client.lifetimeSpendCents ?? 0)} />
            <StatTile label="Completed orders" value={String(client.completedVisits)} />
          </View>
          {payments.length ? (
            <WorkspaceCard title="Payments">
              {payments.map((payment) => <PaymentRow key={payment.id} payment={payment} />)}
            </WorkspaceCard>
          ) : <EmptyState title="Payments" message="No payments on file." />}
        </>
      ) : null}

      {tab === 'Order Notes' ? (
        notes.length
          ? notes.map((note) => <OrderNoteCard key={note.id} note={note} />)
          : <EmptyState title="Order notes" message="Nothing recorded for this guest yet." />
      ) : null}

      <PillRow
        title="Orders"
        subtitle="Review the queue and update order status."
        symbol="calendar"
        onPress={() => setStaffTab('calendar')}
      />
      <PillRow
        title="Point of sale"
        subtitle="Select an eligible order and collect payment."
        symbol="creditcard"
        onPress={() => setStaffTab('checkout')}
      />
    </CollapsingScreen>
  );
}

function LabelledRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.labelledRow}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.labelValue} numberOfLines={2}>{value}</Text>
    </View>
  );
}

function PaymentRow({ payment }: { payment: StaffPayment }) {
  return (
    <View style={styles.entryRow}>
      <View style={styles.entryCopy}>
        <Text style={styles.entryTitle}>{payment.itemName}</Text>
        <Text style={styles.entryMeta}>{`${payment.method.replace('_', ' ')} · ${formatDate(payment.paidAt)}`}</Text>
      </View>
      <MoneyText cents={payment.amountCents} />
    </View>
  );
}

/**
 * A note the bar keeps against a regular's order.
 *
 * The four fields are inherited from the clinical SOAP record this app was
 * rebranded from; the stored data is already about coffee, so only the labels
 * needed rewriting. Renaming the type itself would ripple through the portal
 * contract, which the server still speaks.
 */
function OrderNoteCard({ note }: { note: StaffSoapNote }) {
  return (
    <WorkspaceCard title={note.serviceName}>
      <Text style={styles.entryMeta}>{formatDate(note.treatmentDate)}</Text>
      <NoteLine tag="Asked for" value={note.subjective} />
      <NoteLine tag="Usual" value={note.objective} />
      <NoteLine tag="Notes" value={note.assessment} />
      <NoteLine tag="Next time" value={note.plan} />
    </WorkspaceCard>
  );
}

function NoteLine({ tag, value }: { tag: string; value: string }) {
  return (
    <View style={styles.soapLine}>
      <Text style={styles.soapTag}>{`${tag}:`}</Text>
      <Text style={styles.soapText}>{value}</Text>
    </View>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    .format(new Date(value));
}

const styles = StyleSheet.create({
  subtitle: { color: colors.ink500, fontFamily: fonts.sans, fontSize: 14 },
  search: {
    minHeight: 54,
    borderRadius: radius.pill,
    backgroundColor: colors.brand50,
    paddingHorizontal: spacing.lg,
    color: colors.ink900,
    fontFamily: fonts.sans,
    fontSize: 15,
  },
  tableHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: colors.ink200,
    paddingBottom: spacing.xs,
  },
  tableHeaderText: {
    flex: 1,
    color: colors.ink500,
    fontFamily: fonts.sansBold,
    fontSize: 11,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  tableHeaderRight: { flex: 0, textAlign: 'right' },
  clientRow: {
    minHeight: 66,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.brand50,
  },
  clientCopy: { flex: 1, gap: 2 },
  clientName: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 15 },
  clientEmail: { color: colors.ink500, fontFamily: fonts.sans, fontSize: 12 },
  spendCell: { alignItems: 'flex-end' },
  detailHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  detailHeaderCopy: { flex: 1, gap: 2 },
  tabStrip: { gap: spacing.xs, paddingRight: spacing.md },
  tab: {
    minHeight: 38,
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.warm,
    paddingHorizontal: spacing.md,
  },
  tabActive: { backgroundColor: colors.brand600 },
  tabText: { color: colors.ink700, fontFamily: fonts.sansMedium, fontSize: 14 },
  tabTextActive: { color: colors.white, fontFamily: fonts.sansBold },
  labelledRow: { gap: 2, paddingVertical: spacing.xs },
  label: { color: colors.ink500, fontFamily: fonts.sansMedium, fontSize: 12 },
  labelValue: { color: colors.ink900, fontFamily: fonts.sans, fontSize: 15 },
  tagWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  muted: { color: colors.ink500, fontFamily: fonts.sans, fontSize: 14 },
  entryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  entryCopy: { flex: 1, gap: 2 },
  entryTitle: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 15 },
  entryMeta: { color: colors.ink500, fontFamily: fonts.sans, fontSize: 12 },
  statRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  soapLine: { flexDirection: 'row', gap: spacing.xs },
  soapTag: { width: 18, color: colors.brand600, fontFamily: fonts.sansBold, fontSize: 13 },
  soapText: { flex: 1, color: colors.ink700, fontFamily: fonts.sans, fontSize: 14, lineHeight: 20 },
  pressed: { opacity: 0.75 },
});
