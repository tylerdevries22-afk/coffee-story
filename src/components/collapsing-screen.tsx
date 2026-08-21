import { useCallback, useState, type PropsWithChildren, type ReactNode } from 'react';
import {
  Animated,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewProps,
  type StyleProp,
  type TextStyle,
} from 'react-native';

import { CollapsingPageHeader } from '@/components/collapsing-page-header';
import { Screen, type SurfaceTone } from '@/components/ui';
import { colors } from '@/theme/tokens';

const HEADER_SURFACES: Record<SurfaceTone, string> = {
  light: colors.surface,
  deep: colors.brand900,
  admin: colors.brand100,
  staff: colors.brand50,
};

type CollapsingScreenProps = PropsWithChildren<
  Omit<ScrollViewProps, 'children' | 'onScroll' | 'stickyHeaderIndices'> & {
    title: string;
    eyebrow?: string;
    onBack?: () => void;
    backLabel?: string;
    actions?: ReactNode;
    tone?: SurfaceTone;
    headerBackgroundColor?: string;
    headerBorderColor?: string;
    titleStyle?: StyleProp<TextStyle>;
  }
>;

/**
 * Shared page shell for every scrollable route with a visible title.
 * The first child is always the sticky iOS-style large-title header, so a
 * screen cannot accidentally scroll its title or back affordance away.
 */
export function CollapsingScreen({
  title,
  eyebrow,
  onBack,
  backLabel,
  actions,
  tone = 'light',
  headerBackgroundColor,
  headerBorderColor,
  titleStyle,
  contentContainerStyle,
  children,
  scrollEventThrottle,
  ...props
}: CollapsingScreenProps) {
  const [scrollY] = useState(() => new Animated.Value(0));
  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollY.setValue(event.nativeEvent.contentOffset.y);
  }, [scrollY]);
  const onDark = tone === 'deep';

  return (
    <Screen
      {...props}
      tone={tone}
      stickyHeaderIndices={[0]}
      contentContainerStyle={[{ paddingTop: 0 }, contentContainerStyle]}
      onScroll={handleScroll}
      scrollEventThrottle={scrollEventThrottle ?? 16}
    >
      <CollapsingPageHeader
        title={title}
        eyebrow={eyebrow}
        onBack={onBack}
        backLabel={backLabel}
        actions={actions}
        scrollY={scrollY}
        backgroundColor={headerBackgroundColor ?? HEADER_SURFACES[tone]}
        foregroundColor={onDark ? colors.white : colors.ink900}
        accentColor={onDark ? colors.brand200 : colors.brand700}
        borderColor={headerBorderColor ?? (onDark ? colors.brand700 : colors.ink200)}
        titleStyle={titleStyle}
      />
      {children}
    </Screen>
  );
}
