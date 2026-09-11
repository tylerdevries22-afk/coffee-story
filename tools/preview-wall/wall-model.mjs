export const HARDWARE = Object.freeze({
  desktop: Object.freeze({ x: 12, y: 14, base: 26 }),
  tablet: Object.freeze({ x: 12, y: 12, base: 0 }),
  phone: Object.freeze({ x: 13, y: 14, base: 0 }),
});

const DEVICE_IDS = new Set(['desktop', 'tablet', 'mobile']);
const DEVICE_FRAMES = Object.freeze({ desktop: 'desktop', tablet: 'tablet', mobile: 'phone' });

function record(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function text(value, max) {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

function integer(value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max;
}

function validPreset(value) {
  return record(value) && DEVICE_IDS.has(value.id) && text(value.label, 24)
    && text(value.device, 40) && integer(value.width, 320, 3840)
    && integer(value.height, 568, 2160) && Object.hasOwn(HARDWARE, value.frame)
    && value.frame === DEVICE_FRAMES[value.id];
}

function validAbsoluteUrl(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 500) return false;
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:')
      && !url.username && !url.password;
  } catch {
    return false;
  }
}

function validSurface(value, presetIds) {
  return record(value) && text(value.launch, 64) && text(value.name, 80)
    && integer(value.port, 1, 65_535) && /^\/(?!\/)/.test(value.path)
    && [2, 3].includes(value.span) && Array.isArray(value.devices)
    && value.devices.length === DEVICE_IDS.size
    && new Set(value.devices).size === DEVICE_IDS.size
    && value.devices.every((id) => presetIds.has(id))
    && value.devices.includes(value.activeDevice)
    && (value.url === undefined || validAbsoluteUrl(value.url));
}

function validOrganization(value, launches) {
  if (!record(value) || !text(value.tenantKey, 80) || !text(value.organizationName, 120)
    || !record(value.surfaces)) return false;
  return launches.every((launch) => validAbsoluteUrl(value.surfaces[launch]));
}

export function validWallData(value) {
  if (!record(value) || value.schemaVersion !== 2 || !record(value.context)
    || !text(value.context.tenantKey, 80) || !text(value.context.organizationName, 120)
    || !Array.isArray(value.devicePresets) || value.devicePresets.length !== DEVICE_IDS.size
    || !value.devicePresets.every(validPreset)) return false;
  const presetIds = new Set(value.devicePresets.map(({ id }) => id));
  if (presetIds.size !== DEVICE_IDS.size || !Array.isArray(value.surfaces)
    || value.surfaces.length === 0 || !value.surfaces.every((surface) => validSurface(surface, presetIds))) {
    return false;
  }
  const launches = value.surfaces.map(({ launch }) => launch);
  if (new Set(launches).size !== launches.length) return false;
  if (value.organizations === undefined) return true;
  return Array.isArray(value.organizations)
    && value.organizations.length > 0
    && value.organizations.every((org) => validOrganization(org, launches));
}

export function presetMap(data) {
  return new Map(data.devicePresets.map((preset) => [preset.id, preset]));
}
