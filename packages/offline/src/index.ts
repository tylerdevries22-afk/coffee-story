/**
 * Pure offline-first state for the platform: no runtime dependencies, so HQ
 * (Next.js) and the pickup display can import it too.
 *
 * A peer of `@platform/expo-storage` rather than a module inside it, for the
 * reason that package's own doc comment gives: a package HQ might import must
 * stay free of native runtime dependencies, so the algorithm lives here and
 * the file and secure-store handles are injected by the app. Putting these
 * modules inside `@platform/expo-storage` would invert that split and hand a
 * Next.js consumer `expo-*`; a third package would be machinery ahead of a
 * second consumer.
 *
 * Both modules here are the same concern -- the boundary where state that
 * outlived the process is read back and either trusted or discarded:
 *
 * - the operations intent queue, promoted from `apps/operator`, which
 *   deduplicates retries on the caller's `actionId`, holds a claim before the
 *   completion that depends on it, and keeps a permanent rejection as audit
 *   state instead of dropping it;
 * - the demo portal parsers and load/save orchestration, deduplicated from the
 *   byte-identical copies `apps/customer` and `apps/operator` each carried.
 *
 * There is deliberately no versioned envelope, migration framework, retention
 * policy, or conflict policy here. Add those when a second consumer needs them.
 */
export {
  OPERATION_INTENT_VERSION,
  isOperationIntent,
  type CancelOperationIntent,
  type ClaimOperationIntent,
  type CompleteOperationIntent,
  type OperationIntent,
  type OperationIntentIssue,
  type OperationIntentQueue,
  type OperationIntentRecord,
  type OperationIntentResponse,
  type OperationIssueSeverity,
  type OperationNotApplicableResponse,
  type PermanentOperationIntentConflict,
  type ReleaseOperationIntent,
  type ReportIssueOperationIntent,
} from './operation-intents';
export {
  confirmOperationIntent,
  createOperationIntentQueue,
  enqueueOperationIntent,
  recordPermanentIntentConflict,
  removeOperationIntent,
} from './operation-intent-queue';
export { parseStoredAppMode, parseStoredPortal } from './demo-portal';
export {
  createDemoPortalStore,
  type DemoPortalSeed,
  type DemoPortalStore,
  type PortalTextStore,
} from './demo-portal-store';
