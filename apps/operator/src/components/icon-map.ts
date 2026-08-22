import type { SymbolViewProps } from 'expo-symbols';
import type Ionicons from '@expo/vector-icons/Ionicons';

/**
 * The SF Symbol -> Ionicon translation table, shared by the native and web
 * icon renderers.
 *
 * Both imports here are type-only, so this module pulls no font or native
 * module into any bundle that includes it.
 */
/**
 * Only the plain SF Symbol names, not the `{ ios, android, web }` map form
 * SymbolView also accepts — the translation table below is keyed by string.
 */
export type AppIconName = Extract<SymbolViewProps['name'], string>;

/**
 * SF Symbol → Ionicon. Outline variants are used for unfilled SF names and
 * solid variants for `.fill` ones, which keeps the two sets visually consistent.
 * An unmapped name falls back to a neutral dot rather than rendering nothing,
 * so a missing entry is visible in review instead of silently blank.
 */
export const IONICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  applelogo: 'logo-apple',
  'arrow.down.to.line': 'download-outline',
  'arrow.up.right': 'open-outline',
  bag: 'bag-handle-outline',
  'bag.fill': 'bag-handle',
  banknote: 'cash-outline',
  bell: 'notifications-outline',
  bolt: 'flash-outline',
  calendar: 'calendar-outline',
  'camera.fill': 'camera',
  'car.side.fill': 'car',
  checkmark: 'checkmark',
  'checkmark.circle.fill': 'checkmark-circle',
  'chevron.down': 'chevron-down',
  'chevron.left': 'chevron-back',
  'chevron.right': 'chevron-forward',
  'chevron.up': 'chevron-up',
  clock: 'time-outline',
  creditcard: 'card-outline',
  'creditcard.fill': 'card',
  'cup.and.saucer.fill': 'cafe',
  'doc.plaintext': 'document-outline',
  'doc.text': 'document-text-outline',
  ellipsis: 'ellipsis-horizontal',
  gearshape: 'settings-outline',
  gift: 'gift-outline',
  giftcard: 'gift',
  'rectangle.grid.2x2': 'grid',
  'heart.fill': 'heart',
  house: 'home-outline',
  'house.fill': 'home',
  info: 'information-circle-outline',
  'leaf.fill': 'leaf',
  lock: 'lock-closed-outline',
  'lock.fill': 'lock-closed',
  magnifyingglass: 'search-outline',
  mappin: 'location-outline',
  message: 'chatbubble-outline',
  minus: 'remove',
  paperplane: 'paper-plane-outline',
  pencil: 'pencil-outline',
  'person.2': 'people-outline',
  'person.crop.circle': 'person-circle-outline',
  plus: 'add',
  qrcode: 'qr-code-outline',
  'square.and.arrow.up': 'share-outline',
  'square.grid.2x2': 'grid-outline',
  star: 'star-outline',
  'star.fill': 'star',
  'sun.max': 'sunny-outline',
  tag: 'pricetag-outline',
  trash: 'trash-outline',
  'wallet.pass': 'wallet-outline',
  'wave.3.right': 'radio-outline',
  xmark: 'close',
  'xmark.circle.fill': 'close-circle',
};
