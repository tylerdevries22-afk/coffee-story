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
export {
  fetchBrandBySlug, fetchBrandConfig, subscribeToBrandConfig,
  type BrandSummary,
} from './brand';
export {
  fetchMenuTree, subscribeToMenu,
  type MenuTree, type MenuTreeCategory, type MenuTreeItem,
} from './menu';
export { fetchPublishedCatalog, subscribeToCatalogPublication } from './catalog';
export {
  fetchActiveLocationOrders,
  fetchCustomerOrders,
  fetchLocationOrderStatuses,
  type CustomerOrders, type LocationOrderStatus,
} from './orders';
export {
  fetchLoyaltySummary, fetchLoyaltyStanding, type LoyaltySummary,
} from './loyalty';
export { fetchCustomerByUser, upsertOwnCustomer } from './customers';
export {
  subscribeToLocationOrders,
  subscribeToOrderStatus,
  type LocationOrdersEvent,
} from './realtime';
export { subscribeToLocationSettings, type LocationSettings } from './location';
export {
  fetchPublishedTrainingRelease,
  subscribeToTrainingReleases,
  type PublishedTrainingRelease,
} from './training';
export {
<<<<<<< ours
  cancelOperationOccurrence, claimOperationOccurrence, completeOperationOccurrence, fetchOperationQueue,
  releaseOperationOccurrence, reportOperationIssue, resolveOperationIssue,
  subscribeToOperationQueue, waiveOperationOccurrence,
  OperationDataError,
  type OperationCompletionIssue, type OperationDataErrorCode, type OperationIssueRow,
=======
  claimOperationOccurrence, completeOperationOccurrence, fetchOperationQueue, subscribeToOperationQueue,
>>>>>>> theirs
} from './operations';
export { subscribeToBoardChanges } from './board-realtime';
export { abortRead, readWithRetry, type DataReadOptions, type DataReadResult } from './read-retry';
// How a board splits into columns is a display decision and lives in
// @platform/domain (boardColumns), which also caps and lingers. This
// package's job is the read.
export {
  fetchBoardTickets, orderBoardEntryFromRow, orderCallout,
  type OrderBoardEntry,
} from './board';
export {
  fetchPrepBoard, fetchRecipe, batchScale, mergePrepBoardEntry,
  subscribeToPrepBatches, type PrepBoardEntry,
} from './prep';
export {
  fetchShiftRoster, fetchChecklist, checklistProgress,
  type RosterEntry, type ChecklistItem,
} from './crew';
