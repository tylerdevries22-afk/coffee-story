/**
 * @platform/data — the shared Supabase data layer.
 *
 * Framework-free by design: no React, no react-native, no Expo. Every
 * function takes a SupabaseClient (the apps construct theirs with their own
 * storage adapters; HQ constructs a server client), so the same reads and
 * realtime subscriptions serve the customer app, the operator app, and the
 * HQ console without three drifting copies — which is exactly how the
 * previous duplication happened.
 *
 * Reads go direct to the database under RLS. Trusted writes go through
 * @platform/api-client to the platform API; nothing in this package holds a
 * service-role key.
 */
export { createSupabaseClient, type AuthStorage, type SupabaseClientConfig } from './client';
export { isValidSupabasePublishableKey, isValidSupabaseUrl } from './config';
export { fetchBrandBySlug, type BrandSummary } from './brand';
export { fetchMenuTree, type MenuTree, type MenuTreeCategory, type MenuTreeItem } from './menu';
export {
  fetchActiveLocationOrders,
  fetchCustomerOrders,
  type CustomerOrders,
} from './orders';
export { fetchLoyaltySummary, type LoyaltySummary } from './loyalty';
export { fetchCustomerByUser, upsertOwnCustomer } from './customers';
export {
  subscribeToLocationOrders,
  subscribeToOrderStatus,
  type LocationOrdersEvent,
} from './realtime';
export { fetchBoardTickets, splitBoard, type BoardColumns } from './board';
export {
  fetchPrepBoard, fetchRecipe, batchScale, subscribeToPrepBatches, type PrepBoardEntry,
} from './prep';
export {
  fetchShiftRoster, fetchChecklist, checklistProgress,
  type RosterEntry, type ChecklistItem,
} from './crew';
