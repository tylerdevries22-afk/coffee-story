import type { ReactNode } from 'react';
import { Image, type ImageSourcePropType } from 'react-native';

import {
  AppBody as Body, AppButton as Button, AppCard as Card, AppErrorState,
  AppEyebrow as Eyebrow, AppLoadingState as LoadingState,
  AppMoreFooter as MoreFooter, AppPillRow, AppScreen as Screen,
  AppSectionTitle as SectionTitle, AppSegmented as Segmented,
  AppStaticScreen as StaticScreen, AppTitle as Title,
  useOnDarkSurface, useSurfaceTone, useTokens, type SurfaceTone,
} from '@platform/ui';

import { AppIcon } from '@/components/icon';
import type { AppIconName } from '@/components/icon-map';
import { useBusiness } from '@/state/business';

export {
  Body, Button, Card, Eyebrow, LoadingState, MoreFooter, Screen, SectionTitle,
  Segmented, StaticScreen, Title, useOnDarkSurface, useSurfaceTone,
};
export type { SurfaceTone };

export function ErrorState({ title, message, onRetry }: { title?: string; message: string; onRetry?: () => void }) {
  const { monogram } = useBusiness();
  return <AppErrorState title={title} message={message} onRetry={onRetry} mark={monogram} />;
}

export function PillRow({ title, subtitle, symbol, iconSrc, value, onPress }: {
  title: string; subtitle?: string; symbol?: AppIconName; iconSrc?: ImageSourcePropType;
  value?: ReactNode; onPress?: () => void;
}) {
  const tokens = useTokens();
  const icon = iconSrc
    ? <Image source={iconSrc} style={{ width: 24, height: 24 }} resizeMode="contain" alt="" />
    : symbol ? <AppIcon name={symbol} size={24} tintColor={tokens.textMuted} /> : undefined;
  return <AppPillRow title={title} subtitle={subtitle} icon={icon} value={value} onPress={onPress} />;
}
