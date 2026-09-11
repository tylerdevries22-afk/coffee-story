import * as Haptics from 'expo-haptics';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Platform,
  useWindowDimensions
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  boardColumns,
  type BoardOrder
} from '@/features/operator/board';
import { operatorLayout } from '@/lib/responsive-layout';
import { useOperator } from '@/state/operator-store';
import { queuePositions } from '@platform/domain';
import { useTokens as useBrandTokens } from '@platform/ui';

import { createStyles } from './board-styles';

type BoardSheet = 'none' | 'day' | 'menu' | 'settings' | 'location';

export function useBoardController() {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  const operator = useOperator();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const layout = operatorLayout(width, height);
  const allColumnsVisible = layout.boardColumnsVisible === 3;
  const visibleColumnWidth = Math.max(
    240,
    (width - tokens.spacing.xl * 2 - tokens.spacing.lg * (layout.boardColumnsVisible - 1))
    / layout.boardColumnsVisible,
  );
  const [detail, setDetail] = useState<BoardOrder | null>(null);
  const [sheet, setSheet] = useState<BoardSheet>('none');
  const [locked, setLocked] = useState(false);
  const [clock, setClock] = useState(() => new Date());
  const alerted = useRef<Set<string>>(new Set());

  // Card ages tick every 30s; nobody needs seconds.
  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  // The new-order alert: haptic + the badge the header shows. A sound file
  // needs expo-audio, which this SDK 54 tree does not carry yet; the haptic
  // fires on the device in hand, the badge covers a mounted tablet.
  useEffect(() => {
    const fresh = [...operator.unseenIds].filter((id) => !alerted.current.has(id));
    if (fresh.length === 0) return;
    for (const id of fresh) alerted.current.add(id);
    if (operator.settings.newOrderAlert && Platform.OS !== 'web') {
      // Web has no haptics; navigator.vibrate just logs a blocked-call
      // warning before any interaction. The badge carries the alert there.
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    }
  }, [operator.settings.newOrderAlert, operator.unseenIds]);

  const columns = useMemo(
    () => boardColumns(operator.orders, clock),
    [clock, operator.orders],
  );

  /**
   * The line as the wall display draws it.
   *
   * Computed from the same function the display calls, over the same fields,
   * so the number a barista reads off this card is the number the guest is
   * looking at behind them. Deliberately over `operator.orders` rather than
   * the columns: the queue is one line, and slicing it per column first would
   * have numbered each column from 1.
   */
  const queue = useMemo(
    () => queuePositions(operator.orders.map((order) => ({
      id: order.id,
      status: order.status,
      daily_number: order.dailyNumber,
      updated_at: order.updatedAt,
    }))),
    [operator.orders],
  );
  const detailLive = detail ? operator.orders.find((order) => order.id === detail.id) ?? null : null;
  const columnData = [
    { key: 'paid' as const, title: 'New', orders: columns.paid, tone: tokens.accent ?? tokens.warning },
    { key: 'in_progress' as const, title: 'In progress', orders: columns.in_progress, tone: tokens.secondary },
    { key: 'ready' as const, title: 'Ready', orders: columns.ready, tone: tokens.success },
  ];
  return { tokens, styles, operator, width, height, insets, layout, allColumnsVisible, visibleColumnWidth, detail, setDetail, sheet, setSheet, locked, setLocked, clock, alerted, columns, queue, detailLive, columnData };
}
