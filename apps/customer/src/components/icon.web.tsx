import Ionicons from '@expo/vector-icons/Ionicons';
import type { SymbolViewProps } from 'expo-symbols';
import type { StyleProp, TextStyle, ViewStyle } from 'react-native';

import { IONICON, type AppIconName } from './icon-map';

export type { AppIconName };

/**
 * Web icon renderer.
 *
 * Deliberately never imports expo-symbols at runtime: SF Symbols cannot render
 * in a browser, and merely importing the module pulls a 940 KB Material Symbols
 * font into the bundle — 11% of the demo's payload for something unusable. The
 * `SymbolViewProps` import here is type-only and erased at build time.
 */
export type AppIconProps = {
  name: AppIconName;
  size?: number;
  tintColor: string;
  weight?: SymbolViewProps['weight'];
  style?: StyleProp<ViewStyle & TextStyle>;
};

export function AppIcon({ name, size = 24, tintColor, style }: AppIconProps) {
  return <Ionicons name={IONICON[name] ?? 'ellipse-outline'} size={size} color={tintColor} style={style} />;
}
