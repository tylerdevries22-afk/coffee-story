/** Menu-item card + the drop countdown chip that can ride on it. */
import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Badge, withAlpha } from './components.tsx';
import { dropPhase, formatCountdown } from './drop-countdown-logic.ts';
import { useCopy, useTokens } from './theme.tsx';

export function ItemCard({
  name,
  priceLabel,
  description,
  is86d,
  media,
  ribbon,
  onPress,
}: {
  name: string;
  priceLabel: string;
  description?: string;
  /** 86'd = out for the day; the card stays visible but flat and unpressable. */
  is86d?: boolean;
  media?: ReactNode;
  ribbon?: ReactNode;
  onPress: () => void;
}) {
  const tokens = useTokens();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={is86d ? `${name}, sold out today` : `${name}, ${priceLabel}`}
      accessibilityState={{ disabled: Boolean(is86d) }}
      disabled={is86d}
      onPress={onPress}
      style={({ pressed }) => ({
        borderRadius: tokens.radius.md,
        backgroundColor: tokens.surfaceElevated,
        overflow: 'hidden',
        opacity: is86d ? 0.55 : pressed ? 0.85 : 1,
      })}
    >
      {media}
      <View style={{ padding: tokens.spacing.md, gap: tokens.spacing.xs }}>
        {ribbon}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: tokens.spacing.sm }}>
          <Text style={{ flex: 1, fontFamily: tokens.fontDisplay, fontSize: 16, color: tokens.textPrimary }} numberOfLines={2}>
            {name}
          </Text>
          <Text style={{ fontFamily: tokens.fontBody, fontWeight: '700', fontSize: 15, color: tokens.textPrimary }}>
            {priceLabel}
          </Text>
        </View>
        {description ? (
          <Text style={{ fontFamily: tokens.fontBody, fontSize: 13, lineHeight: 18, color: tokens.textMuted }} numberOfLines={2}>
            {description}
          </Text>
        ) : null}
        {is86d ? <Badge label="Sold out today" tone="danger" /> : null}
      </View>
    </Pressable>
  );
}

/**
 * Live countdown for a drop window. Ticks once a second while mounted; the
 * text sits inside a plain View (never animated -- see the Fabric note in
 * AGENTS.md, which is why this deliberately avoids driving Text opacity).
 */
export function DropCountdown({ startsAt, endsAt }: { startsAt: Date; endsAt: Date }) {
  const tokens = useTokens();
  const copy = useCopy();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const phase = dropPhase(startsAt, endsAt, now);
  if (phase === 'ended') return null;
  const label = phase === 'live'
    ? copy('dropEndsIn', { time: formatCountdown(endsAt, now) })
    : copy('dropStartsIn', { time: formatCountdown(startsAt, now) });

  return (
    <View
      accessibilityLiveRegion="polite"
      style={{
        alignSelf: 'flex-start',
        flexDirection: 'row',
        alignItems: 'center',
        gap: tokens.spacing.xs,
        paddingHorizontal: tokens.spacing.sm,
        paddingVertical: tokens.spacing.xs,
        borderRadius: tokens.radius.pill,
        backgroundColor: withAlpha(tokens.accent, 0.15),
      }}
    >
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: tokens.accent }} />
      <Text style={{ fontFamily: tokens.fontBody, fontWeight: '700', fontSize: 12, color: tokens.textPrimary }}>
        {label}
      </Text>
    </View>
  );
}
