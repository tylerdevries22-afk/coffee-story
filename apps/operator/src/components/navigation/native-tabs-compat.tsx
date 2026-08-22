import * as NativeTabsModule from 'expo-router/unstable-native-tabs';
import type { ComponentType } from 'react';
import type { ColorValue, ImageSourcePropType } from 'react-native';

/**
 * One import site for `expo-router`'s native tab elements, because the two
 * versions this source tree has to compile against disagree about where they
 * live.
 *
 * `mobile/` runs expo-router 57 and `mobile-expo-go-demo/` runs 6.0.24 (the
 * newest Expo Go SDK 54 will load), and `npm run check:mobile-sync` requires
 * the two `src/` trees to stay byte-identical. The tab elements moved between
 * those releases:
 *
 * - 6.0.24 exports `Icon` / `Label` at the module top level, and
 *   `NativeTabs.Trigger` carries only `TabBar`.
 * - 57 removed the top-level exports and hung `Icon` / `Label` / `Badge` off
 *   `NativeTabs.Trigger` instead.
 *
 * Neither spelling type-checks against the other version, so a shared file
 * cannot name either one directly. Resolving them through a widened view of
 * the module is the only form that compiles in both trees. The JSX is
 * unaffected: both releases expect the elements as children of a trigger, so
 * only the component identity differs.
 *
 * The cast is the point of the file and is deliberately confined to it — every
 * other module imports `TabIcon` / `TabLabel` from here and stays fully typed.
 * `assertResolved` turns the next API move into an immediate, named failure in
 * development rather than a tab bar that silently renders without icons.
 */

/**
 * SF Symbols the two tab bars use, spelled out rather than pulled from
 * `sf-symbols-typescript`. Going through the widened module view drops the
 * library's own name checking, so this union is what catches a typo — and a
 * mistyped symbol is invisible at runtime, it just renders nothing.
 */
export type TabSymbol =
  | 'house' | 'house.fill'
  | 'gift' | 'gift.fill'
  | 'calendar'
  | 'ellipsis' | 'ellipsis.circle' | 'ellipsis.circle.fill'
  | 'plus.circle' | 'plus.circle.fill'
  | 'sun.max' | 'sun.max.fill'
  | 'heart' | 'person.circle'
  | 'cup.and.saucer' | 'cup.and.saucer.fill'
  | 'person.2' | 'person.2.fill'
  | 'rectangle.grid.2x2' | 'rectangle.grid.2x2.fill';

/** A symbol that changes when its tab is selected, the way UIKit's own do. */
export type TabSymbolPair = { default: TabSymbol; selected: TabSymbol };

export type TabIconProps = {
  sf?: TabSymbol | TabSymbolPair;
  /**
   * A template image, for the one mark with no SF Symbol equivalent. UIKit
   * tints it from `iconColor` / `tintColor` exactly as it tints a symbol.
   */
  src?: ImageSourcePropType;
  /**
   * `original` keeps a full-colour image (the avatar circles) instead of
   * letting UIKit template-tint it. Only expo-router 57 forwards this prop;
   * the 6.0.24 Icon in the demo twin ignores it, which is safe: unhandled
   * props are dropped before the native side ever sees them.
   */
  renderingMode?: 'template' | 'original';
  selectedColor?: ColorValue;
};

export type TabLabelProps = { children?: string; hidden?: boolean };

type NativeTabsCompatModule = {
  NativeTabs: { Trigger?: { Icon?: ComponentType<TabIconProps>; Label?: ComponentType<TabLabelProps> } };
  Icon?: ComponentType<TabIconProps>;
  Label?: ComponentType<TabLabelProps>;
};

const compat = NativeTabsModule as unknown as NativeTabsCompatModule;

function assertResolved<P>(
  component: ComponentType<P> | undefined,
  name: string,
): ComponentType<P> {
  if (component) return component;
  if (__DEV__) {
    throw new Error(
      `expo-router's native tab <${name}> could not be resolved from either the `
      + 'top-level export or NativeTabs.Trigger. The native tabs API moved again — '
      + 'update src/components/navigation/native-tabs-compat.tsx.',
    );
  }
  // A shipped build keeps a navigable bar rather than crashing on a missing
  // glyph, so a runtime that outran this shim degrades instead of failing.
  return () => null;
}

export const NativeTabs = NativeTabsModule.NativeTabs;
export const TabIcon = assertResolved(compat.NativeTabs.Trigger?.Icon ?? compat.Icon, 'Icon');
export const TabLabel = assertResolved(compat.NativeTabs.Trigger?.Label ?? compat.Label, 'Label');
