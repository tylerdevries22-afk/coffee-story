/**
 * Order placement, tender-first.
 *
 * Split by concern: request guards (request), placement (create-order), pack
 * contents (pack-contents), platform fees (platform-fees), Square cart lines
 * (square-lines), card capture (capture-payment), hosted checkout
 * (checkout-link), guest cancellation (cancel-order) and refunds
 * (refund-order). Shared row shapes and result plumbing live in internal.
 *
 * Everything external is injected (service-role Supabase client, Square
 * config + the location's decrypted token), which keeps this testable and
 * keeps credentials at the edges.
 */
export * from './orders/types';
export * from './orders/request';
export * from './orders/create-order';
export { recordPlatformFee } from './orders/platform-fees';
export * from './orders/square-lines';
export * from './orders/capture-payment';
export * from './orders/checkout-link';
export * from './orders/cancel-order';
export * from './orders/refund-order';
