/**
 * Phase 2.4 dual-read: resolve a tenant's capabilities from both the legacy
 * `brands` flag columns and `module_installations`, and report where they
 * disagree.
 *
 * The flags stay authoritative until the module cutover; this resolver never
 * gates anything. It exists so the drift between the two entitlement
 * surfaces is visible as structured telemetry while the backfill and the
 * module lifecycle bed in. Fail-open by contract: a brand row that will not
 * load, an installation query that errors, or a resolver that throws must
 * never break the request it rides on -- it logs `capability_drift_error`
 * and returns null instead.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  activeModuleKeys, capabilityDrift,
  type CapabilityDriftRecord, type LegacyFlagRecord, type ModuleInstallationRow,
} from '@platform/module-kit';

/** The legacy flag columns the dual-read window compares against. */
export type BrandCapabilityFlags = {
  drops: boolean;
  catering: boolean;
  delivery: boolean;
  stored_value: boolean;
  referrals: boolean;
  operations: boolean;
};

export type TenantCapabilityResolution = {
  readonly brandId: string;
  readonly flags: BrandCapabilityFlags | null;
  /** Active, registry-known module keys; informational only for now. */
  readonly modules: readonly string[];
  readonly drift: readonly CapabilityDriftRecord[];
};

/** Injectable so tests capture lines instead of parsing console output. */
export type CapabilityTelemetry = {
  readonly warn: (line: Record<string, unknown>) => void;
  readonly error: (line: Record<string, unknown>) => void;
  readonly now: () => Date;
};

const consoleTelemetry: CapabilityTelemetry = {
  warn: (line) => console.warn(JSON.stringify(line)),
  error: (line) => console.error(JSON.stringify(line)),
  now: () => new Date(),
};

export async function resolveTenantCapabilities(
  service: SupabaseClient,
  brandId: string,
  telemetry: CapabilityTelemetry = consoleTelemetry,
): Promise<TenantCapabilityResolution | null> {
  try {
    const [brand, installations] = await Promise.all([
      service.from('brands')
        .select('drops, catering, delivery, stored_value, referrals, operations')
        .eq('id', brandId)
        .maybeSingle<BrandCapabilityFlags>(),
      service.from('module_installations')
        .select('module_key, version, state, config_revision')
        .eq('brand_id', brandId)
        .returns<ModuleInstallationRow[]>(),
    ]);
    const failure = brand.error ?? installations.error;
    if (failure) {
      telemetry.error({
        event: 'capability_drift_error', brandId,
        reason: failure.message, at: telemetry.now().toISOString(),
      });
      return null;
    }
    const flags: LegacyFlagRecord = brand.data ?? {};
    const rows = installations.data ?? [];
    const drift = capabilityDrift(rows, flags);
    if (drift.length > 0) {
      telemetry.warn({
        event: 'capability_drift', brandId, drift,
        at: telemetry.now().toISOString(),
      });
    }
    return { brandId, flags: brand.data, modules: activeModuleKeys(rows), drift };
  } catch (error) {
    telemetry.error({
      event: 'capability_drift_error', brandId,
      reason: error instanceof Error ? error.message : String(error),
      at: telemetry.now().toISOString(),
    });
    return null;
  }
}
