/**
 * The dual-read comparison between legacy flags and module installations.
 *
 * Until the module cutover completes, the boolean columns on `brands` still
 * gate capabilities while `module_installations` says what the new world
 * believes. This module compares the two without reading either one itself:
 * callers hand it rows and flags, it hands back the enabled set each side
 * sees and every disagreement between them. Drift is data, never an error --
 * an unknown module key or a half-migrated tenant must produce a report, not
 * an exception, because the apps calling this mid-request cannot fail on it.
 *
 * Report order is deterministic (flag map order, then registry order, then
 * input order), so two runs over the same state emit byte-identical drift and
 * a log line can be diffed against yesterday's.
 */
import { LEGACY_FLAG_MODULE_MAP, MODULE_REGISTRY } from './registry';

/** One `module_installations` row, reduced to what the comparison reads. */
export type ModuleInstallationRow = {
  readonly module_key: string;
  readonly version: string;
  readonly state: string;
  readonly config_revision: number;
};

/** The legacy `brands` flag columns; unmapped columns are ignored. */
export type LegacyFlagRecord = Readonly<Record<string, boolean | undefined>>;

export type CapabilityDriftDirection = 'flag-only' | 'module-only' | 'unknown-module';

/**
 * One disagreement. `flag` is null when no legacy flag speaks for the module
 * (unmapped registry module, or a key the registry does not know);
 * `installationState` is null when the brand has no installation row.
 */
export type CapabilityDriftRecord = {
  readonly moduleKey: string;
  readonly flag: boolean | null;
  readonly installationState: string | null;
  readonly direction: CapabilityDriftDirection;
};

/** The unique (brand_id, module_key) constraint makes repeats theoretical; first row wins. */
function firstRowByKey(
  installations: readonly ModuleInstallationRow[],
): Map<string, ModuleInstallationRow> {
  const byKey = new Map<string, ModuleInstallationRow>();
  for (const row of installations) {
    if (!byKey.has(row.module_key)) byKey.set(row.module_key, row);
  }
  return byKey;
}

/** Module keys whose installation grants the capability right now: active, and known to the registry. */
export function activeModuleKeys(installations: readonly ModuleInstallationRow[]): string[] {
  const known = new Set(MODULE_REGISTRY.map((definition) => definition.key));
  return [...new Set(
    installations
      .filter((row) => row.state === 'active' && known.has(row.module_key))
      .map((row) => row.module_key),
  )].sort();
}

/** Module keys the legacy flags grant, in flag-map order. Unmapped flags never appear. */
export function flagModuleKeys(flags: LegacyFlagRecord): string[] {
  return Object.entries(LEGACY_FLAG_MODULE_MAP)
    .filter(([flag]) => flags[flag] === true)
    .map(([, moduleKey]) => moduleKey);
}

/** Every disagreement between the two entitlement surfaces. Empty means they agree. */
export function capabilityDrift(
  installations: readonly ModuleInstallationRow[],
  flags: LegacyFlagRecord,
): CapabilityDriftRecord[] {
  const byKey = firstRowByKey(installations);
  const mapped = new Set<string>(Object.values(LEGACY_FLAG_MODULE_MAP));
  const known = new Set(MODULE_REGISTRY.map((definition) => definition.key));
  const drift: CapabilityDriftRecord[] = [];

  for (const [flag, moduleKey] of Object.entries(LEGACY_FLAG_MODULE_MAP)) {
    const flagOn = flags[flag] === true;
    const installation = byKey.get(moduleKey);
    if (flagOn === (installation?.state === 'active')) continue;
    drift.push({
      moduleKey,
      flag: flagOn,
      installationState: installation?.state ?? null,
      direction: flagOn ? 'flag-only' : 'module-only',
    });
  }

  // A live module no flag maps to is the cutover arriving early: worth one
  // record per module, so the dual-read window shows progress, not silence.
  for (const definition of MODULE_REGISTRY) {
    if (mapped.has(definition.key)) continue;
    const installation = byKey.get(definition.key);
    if (installation?.state !== 'active') continue;
    drift.push({
      moduleKey: definition.key, flag: null,
      installationState: installation.state, direction: 'module-only',
    });
  }

  for (const row of installations) {
    if (known.has(row.module_key)) continue;
    drift.push({
      moduleKey: row.module_key, flag: null,
      installationState: row.state, direction: 'unknown-module',
    });
  }
  return drift;
}
