/**
 * @platform/domain — the guest-and-shift domain, framework-free.
 *
 * Every export here is reachable from `node:test` without a renderer and from
 * any of the five surfaces without an app alias. Nothing in this package
 * imports React, react-native, Expo, or an asset.
 */
export * from './domain';
export * from './money';
export * from './tax';
export * from './dates';
export * from './sizes';
export * from './totals';
export * from './fulfillment';
export * from './request-key';
export * from './rules';
export * from './information-pages';
export * from './client-search';
export * from './feed';
export * from './intent-links';
export * from './portal-navigation';
export * from './item-projections';
export * from './add-ons';
export * from './menu-options';
export * from './cart';
export * from './board-display';
export * from './qr';
