/**
 * The live order board: three working columns plus the scheduled lane,
 * iPad-first: two lanes stay visible in portrait and all three fit in
 * landscape; phones page through one lane at a time.
 * Tap targets are shift-floor sized; KDS mode drops prices and grows type.
 */
import {
  Pressable,
  ScrollView,
  Text,
  View
} from 'react-native';


import { HeaderButton } from './board/board-controls';
import { DaySheet, MenuControlSheet } from './board/day-menu-sheets';
import { OrderCard } from './board/order-card';
import { OrderDetail } from './board/order-detail';
import { PinGate } from './board/pin-gate';
import { LocationSheet, SettingsSheet } from './board/settings-sheets';
import { useBoardController } from './board/use-board-controller';

export function OrdersBoardScreen() {
  const { tokens, styles, operator, insets, layout, allColumnsVisible, visibleColumnWidth, setDetail, sheet, setSheet, locked, setLocked, clock, columns, queue, detailLive, columnData } = useBoardController();
  if (locked) {
    return <PinGate onUnlock={() => setLocked(false)} />;
  }
  return (
    <View style={[styles.screen, { paddingTop: insets.top + tokens.spacing.md }]}>
      <View style={styles.header}>
        <View style={styles.headerMain}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Location: ${operator.location.name}. Change`}
            onPress={() => setSheet('location')}
            style={({ pressed }) => [styles.headerChip, pressed && styles.pressed]}
          >
            <Text numberOfLines={1} style={styles.headerChipText}>{operator.location.name}</Text>
          </Pressable>
          <Text accessibilityRole="header" style={styles.headerTitle}>Orders</Text>
          {operator.unseenIds.size > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${operator.unseenIds.size} new orders. Mark seen`}
              onPress={operator.markSeen}
              style={styles.newBadge}
            >
              <Text style={styles.newBadgeText}>{operator.unseenIds.size} new</Text>
            </Pressable>
          ) : null}
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.headerActions}
        >
          <HeaderButton label="Menu" onPress={() => setSheet('menu')} />
          <HeaderButton label="Day" onPress={() => setSheet('day')} />
          <HeaderButton label="Settings" onPress={() => setSheet('settings')} />
          <HeaderButton label="Lock" onPress={() => setLocked(true)} />
        </ScrollView>
      </View>

      {columns.scheduled.length > 0 ? (
        <View style={styles.lane}>
          <Text style={styles.laneTitle}>Scheduled</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.laneRow}>
            {columns.scheduled.map((order) => (
              <Pressable
                key={order.id}
                accessibilityRole="button"
                accessibilityLabel={`Scheduled order ${order.shortCode} for ${order.guestName}`}
                onPress={() => setDetail(order)}
                style={({ pressed }) => [styles.laneCard, pressed && styles.pressed]}
              >
                <Text style={styles.laneCode}>{order.shortCode}</Text>
                <Text style={styles.laneWhen}>
                  {order.scheduledFor
                    ? new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(new Date(order.scheduledFor))
                    : ''}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}

      <ScrollView
        horizontal={!allColumnsVisible}
        pagingEnabled={!allColumnsVisible && layout.boardColumnsVisible === 1}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[styles.columns, allColumnsVisible && styles.columnsWide]}
        style={styles.columnsScroll}
      >
        {columnData.map((column) => (
          <View
            key={column.key}
            style={[
              styles.column,
              !allColumnsVisible && {
                flexGrow: 0,
                flexShrink: 0,
                flexBasis: 'auto',
                width: visibleColumnWidth,
              },
            ]}
          >
            <View style={styles.columnHeader}>
              <View style={[styles.columnDot, { backgroundColor: column.tone }]} />
              <Text style={styles.columnTitle}>{column.title}</Text>
              <Text style={styles.columnCount}>{column.orders.length}</Text>
            </View>
            <ScrollView contentContainerStyle={styles.columnBody} showsVerticalScrollIndicator={false}>
              {column.orders.length === 0 ? (
                <Text style={styles.columnEmpty}>Nothing here.</Text>
              ) : column.orders.map((order) => (
                <OrderCard
                  key={order.id}
                  order={order}
                  queuePosition={queue.get(order.id) ?? null}
                  now={clock}
                  kds={operator.settings.kdsMode}
                  fresh={operator.unseenIds.has(order.id)}
                  onOpen={() => setDetail(order)}
                  onAdvance={(to) => operator.advance(order.id, to)}
                />
              ))}
            </ScrollView>
          </View>
        ))}
      </ScrollView>

      <OrderDetail
        order={detailLive}
        onClose={() => setDetail(null)}
        onAdvance={(to) => detailLive && operator.advance(detailLive.id, to)}
        onCancel={() => {
          if (detailLive) operator.cancel(detailLive.id);
          setDetail(null);
        }}
        onRefund={(amount) => {
          if (detailLive) operator.refund(detailLive.id, amount);
          setDetail(null);
        }}
      />

      <DaySheet visible={sheet === 'day'} onClose={() => setSheet('none')} />
      <MenuControlSheet visible={sheet === 'menu'} onClose={() => setSheet('none')} />
      <SettingsSheet visible={sheet === 'settings'} onClose={() => setSheet('none')} />
      <LocationSheet visible={sheet === 'location'} onClose={() => setSheet('none')} />
    </View>
  );
}
