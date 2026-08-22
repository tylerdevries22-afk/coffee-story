import Ionicons from '@expo/vector-icons/Ionicons';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { Platform, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

import { IONICON, type AppIconName } from './icon-map';

export type { AppIconName };

/**
 * One icon for every platform (native build).
 *
 * iOS gets the real SF Symbol, which carries Apple's optical sizing and weight
 * matching and is what the app was designed around. Android has no SF Symbols,
 * so it falls back to the nearest Ionicon.
 *
 * Icons are addressed by their SF Symbol name throughout the app so the iOS
 * build stays canonical; `icon-map.ts` is the translation layer.
 *
 * The web build uses `icon.web.tsx` instead, which never imports expo-symbols —
 * doing so drags a 940 KB Material Symbols font into a bundle that can never
 * render one.
 */
export type AppIconProps = {
  name: AppIconName;
  size?: number;
  tintColor: string;
  weight?: SymbolViewProps['weight'];
  style?: StyleProp<ViewStyle & TextStyle>;
};

export function AppIcon({ name, size = 24, tintColor, weight, style }: AppIconProps) {
  if (Platform.OS === 'ios') {
    return <SymbolView name={name} size={size} tintColor={tintColor} weight={weight} style={style} />;
  }
  return <Ionicons name={IONICON[name] ?? 'ellipse-outline'} size={size} color={tintColor} style={style} />;
}
