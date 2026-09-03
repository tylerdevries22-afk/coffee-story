export {
  ACTIVATION_STATES, APP_SURFACES, OFFLINE_CONTRIBUTIONS,
  type ActivationState, type AppSurface, type ModuleDefinition, type ModuleDependency,
  type OfflineContribution, type ResolvedCapabilitySnapshot, type ResolvedModule,
} from './types';
export { compareSemVer, parseSemVer, satisfiesRange, type SemVer } from './semver';
export { dependencySatisfied, parseModuleDefinition, type ManifestResult } from './manifest';
export { parseIndustryBlueprint, type BlueprintResult, type IndustryBlueprint } from './blueprint';
export {
  installedModuleKeys, parseTenantModulesManifest,
  type TenantModuleInstall, type TenantModulesManifest, type TenantModulesResult,
} from './modules-manifest';
export {
  CUSTOMER_FACING_MODULE_KEYS, STOREFRONT_CAPABILITIES, STOREFRONT_CAPABILITY_MODULE,
  storefrontCapabilitiesOf,
  type StorefrontCapabilities, type StorefrontCapability,
} from './storefront-capabilities';
export {
  revalidateStorefrontCapabilities,
  type CapabilityCache, type CapabilityRevalidation, type CapabilitySnapshot,
  type RevalidationInput,
} from './capability-revalidation';
export { resolveModules, type ResolutionError, type ResolutionResult } from './resolve';
export { LEGACY_FLAG_MODULE_MAP, MODULE_REGISTRY, legacyFlagInstallations } from './registry';
export {
  ACTIVATION_CHECK_IDS, canTransition, evaluateActivation, parseActivationState,
  transitionActivation,
  type ActivationCheck, type ActivationCheckId, type ActivationEvaluation, type TransitionResult,
} from './activation';
export {
  buildCapabilitySnapshot, canonicalJson, snapshotAuthorizes, snapshotGrants,
  verifyCapabilitySnapshot,
  type SnapshotSigner, type SnapshotVerification, type SnapshotVerifier,
} from './snapshot';
