import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseTenantModulesManifest } from '../packages/module-kit/src/modules-manifest';

export type DeviceId = 'desktop' | 'tablet' | 'mobile';
export type Frame = 'desktop' | 'tablet' | 'phone';

export type DevicePreset = {
  id: DeviceId;
  label: string;
  device: string;
  width: number;
  height: number;
  frame: Frame;
};

export type DevicePreference = { whenCapability: string; device: DeviceId };
export type NamePreference = { whenCapability: string; name: string };

export type WallSurface = {
  launch: string;
  name: string;
  port: number;
  path: string;
  span: number;
  devices: DeviceId[];
  defaultDevice: DeviceId;
  devicePreferences?: DevicePreference[];
  namePreferences?: NamePreference[];
};

export type WallSource = {
  schemaVersion: number;
  devicePresets: DevicePreset[];
  surfaces: WallSurface[];
};

export type TenantContext = {
  tenantKey: string;
  organizationName: string;
  capabilities: string[];
};

export type PublishedSurface = WallSurface & { activeDevice: DeviceId };
export type PublishedWall = Omit<WallSource, 'surfaces'> & {
  context: Omit<TenantContext, 'capabilities'>;
  surfaces: PublishedSurface[];
};

const DEVICE_IDS = new Set<DeviceId>(['desktop', 'tablet', 'mobile']);
const FRAMES = new Set<Frame>(['desktop', 'tablet', 'phone']);
const DEVICE_FRAMES: Readonly<Record<DeviceId, Frame>> = {
  desktop: 'desktop', tablet: 'tablet', mobile: 'phone',
};
const TENANT_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}

function isDeviceId(value: unknown): value is DeviceId {
  return typeof value === 'string' && DEVICE_IDS.has(value as DeviceId);
}

function validPreset(value: unknown): value is DevicePreset {
  return isRecord(value)
    && isDeviceId(value.id)
    && typeof value.label === 'string' && value.label.length > 0 && value.label.length <= 24
    && typeof value.device === 'string' && value.device.length > 0 && value.device.length <= 40
    && isPositiveInteger(value.width) && value.width >= 320 && value.width <= 3840
    && isPositiveInteger(value.height) && value.height >= 568 && value.height <= 2160
    && typeof value.frame === 'string'
    && FRAMES.has(value.frame as Frame)
    && value.frame === DEVICE_FRAMES[value.id];
}

function validPreference(value: unknown): value is DevicePreference {
  return isRecord(value)
    && typeof value.whenCapability === 'string'
    && value.whenCapability.length > 0
    && isDeviceId(value.device);
}

function validNamePreference(value: unknown): value is NamePreference {
  return isRecord(value)
    && typeof value.whenCapability === 'string'
    && value.whenCapability.length > 0
    && typeof value.name === 'string'
    && value.name.length > 0;
}

function validSurface(value: unknown, presetIds: Set<DeviceId>): value is WallSurface {
  if (!isRecord(value) || typeof value.launch !== 'string' || typeof value.name !== 'string'
    || value.launch.length === 0 || value.launch.length > 64
    || value.name.length === 0 || value.name.length > 80
    || !isPositiveInteger(value.port) || value.port > 65_535
    || typeof value.path !== 'string' || !/^\/(?!\/)/.test(value.path)
    || !isPositiveInteger(value.span) || ![2, 3].includes(value.span) || !Array.isArray(value.devices)
    || new Set(value.devices).size !== DEVICE_IDS.size || value.devices.length !== DEVICE_IDS.size
    || !value.devices.every((id) => isDeviceId(id) && presetIds.has(id))
    || !isDeviceId(value.defaultDevice) || !value.devices.includes(value.defaultDevice)) return false;
  const validDevicePreferences = value.devicePreferences === undefined
    || (Array.isArray(value.devicePreferences) && value.devicePreferences.every(validPreference));
  const validNamePreferences = value.namePreferences === undefined
    || (Array.isArray(value.namePreferences) && value.namePreferences.every(validNamePreference));
  return validDevicePreferences && validNamePreferences;
}

export function parseWallSource(value: unknown): WallSource {
  if (!isRecord(value) || value.schemaVersion !== 2 || !Array.isArray(value.devicePresets)
    || value.devicePresets.length !== DEVICE_IDS.size || !value.devicePresets.every(validPreset)) {
    throw new Error('Preview wall requires three valid canonical device presets.');
  }
  const presetIds = new Set(value.devicePresets.map((preset) => preset.id));
  if (presetIds.size !== DEVICE_IDS.size || !Array.isArray(value.surfaces)
    || value.surfaces.length === 0 || !value.surfaces.every((surface) => validSurface(surface, presetIds))) {
    throw new Error('Preview wall contains an invalid surface definition.');
  }
  const launches = value.surfaces.map((surface) => surface.launch);
  if (new Set(launches).size !== launches.length) {
    throw new Error('Preview wall surface launch names must be unique.');
  }
  return value as WallSource;
}

export function parseBuildContext(value: unknown): string {
  if (!isRecord(value) || typeof value.tenantKey !== 'string' || !TENANT_SLUG.test(value.tenantKey)) {
    throw new Error('The preview wall build context is invalid; run a full preview export.');
  }
  return value.tenantKey;
}

export function requestedTenant(args: string[], environmentTenant: string | undefined): string | undefined {
  const index = args.indexOf('--tenant');
  const cliTenant = index >= 0 ? args[index + 1]?.trim() : undefined;
  const environment = environmentTenant?.trim() || undefined;
  if (index >= 0 && (!cliTenant || !TENANT_SLUG.test(cliTenant))) {
    throw new Error('--tenant requires a valid tenant slug.');
  }
  if (cliTenant && environment && cliTenant !== environment) {
    throw new Error(`--tenant ${cliTenant} conflicts with EXPO_PUBLIC_TENANT=${environment}.`);
  }
  return cliTenant ?? environment;
}

export function resolveWall(source: WallSource, context: TenantContext): PublishedWall {
  const enabled = new Set(context.capabilities);
  return {
    ...source,
    context: { tenantKey: context.tenantKey, organizationName: context.organizationName },
    surfaces: source.surfaces.map((surface) => {
      const matched = surface.devicePreferences?.find((rule) => enabled.has(rule.whenCapability));
      const presentation = surface.namePreferences?.find((rule) => enabled.has(rule.whenCapability));
      const activeDevice = matched && surface.devices.includes(matched.device)
        ? matched.device
        : surface.defaultDevice;
      return { ...surface, name: presentation?.name ?? surface.name, activeDevice };
    }),
  };
}

export function readTenantContext(root: string, tenantSlug: string | undefined): TenantContext {
  if (!tenantSlug) {
    return { tenantKey: 'generic', organizationName: 'Local preview', capabilities: [] };
  }
  if (!TENANT_SLUG.test(tenantSlug)) throw new Error(`Invalid tenant slug "${tenantSlug}".`);
  const tenantRoot = join(root, 'tenants', tenantSlug);
  const modulePath = join(tenantRoot, 'modules.json');
  const brandPath = join(tenantRoot, 'brand.json');
  let modules: unknown;
  let brand: unknown;
  try {
    modules = JSON.parse(readFileSync(modulePath, 'utf8')) as unknown;
  } catch {
    throw new Error(`${modulePath} must contain valid JSON.`);
  }
  try {
    brand = JSON.parse(readFileSync(brandPath, 'utf8')) as unknown;
  } catch {
    throw new Error(`${brandPath} must contain valid JSON.`);
  }
  const parsedModules = parseTenantModulesManifest(modules);
  if (parsedModules.kind !== 'ok') {
    throw new Error(`${modulePath} is invalid: ${parsedModules.issues.join('; ')}`);
  }
  if (!isRecord(brand) || !isRecord(brand.identity)
    || brand.identity.slug !== tenantSlug || typeof brand.identity.name !== 'string'
    || brand.identity.name.trim().length === 0 || brand.identity.name.length > 120) {
    throw new Error(`${brandPath} must contain the requested tenant identity and organization name.`);
  }
  const capabilities = parsedModules.manifest.modules
    .filter((module) => module.enabled)
    .map((module) => module.key);
  return { tenantKey: tenantSlug, organizationName: brand.identity.name.trim(), capabilities };
}
