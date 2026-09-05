import type { TenantLocation } from './types';
import { isRecord } from './parse-metadata';

const LOCATION_KEYS = new Set(['name', 'address', 'note', 'timezone', 'hours']);

function parseStringRecord(value: unknown, path: string, issues: string[]): Record<string, string> {
  if (!isRecord(value) || Object.values(value).some((entry) => typeof entry !== 'string')) {
    issues.push(`${path} must be an object of strings`);
    return {};
  }
  return value as Record<string, string>;
}

function parseHours(value: unknown, path: string, issues: string[]): TenantLocation['hours'] {
  if (!isRecord(value)) {
    issues.push(`${path} must be an object of daily time spans`);
    return {};
  }
  const hours: Record<string, { open: string; close: string }[]> = {};
  for (const [day, spans] of Object.entries(value)) {
    if (!Array.isArray(spans)) {
      issues.push(`${path}.${day} must be a list`);
      continue;
    }
    const parsed = spans.filter((span): span is { open: string; close: string } =>
      isRecord(span) && Object.keys(span).every((key) => key === 'open' || key === 'close')
      && typeof span.open === 'string' && typeof span.close === 'string');
    if (parsed.length !== spans.length) issues.push(`${path}.${day} entries must contain only open and close strings`);
    hours[day] = parsed;
  }
  return hours;
}

function parseLocation(value: unknown, index: number, issues: string[]): TenantLocation | null {
  const path = `locations[${index}]`;
  if (!isRecord(value) || Object.keys(value).some((key) => !LOCATION_KEYS.has(key))) {
    issues.push(`${path} contains unsupported fields`);
    return null;
  }
  if (typeof value.name !== 'string' || value.name.trim().length === 0) issues.push(`${path}.name is required`);
  if (typeof value.timezone !== 'string' || !value.timezone.includes('/')) issues.push(`${path}.timezone must be an IANA zone`);
  if (value.note !== undefined && typeof value.note !== 'string') issues.push(`${path}.note must be a string`);
  const address = parseStringRecord(value.address, `${path}.address`, issues);
  const hours = parseHours(value.hours, `${path}.hours`, issues);
  if (typeof value.name !== 'string' || typeof value.timezone !== 'string') return null;
  return { name: value.name, address, timezone: value.timezone, hours,
    ...(typeof value.note === 'string' ? { note: value.note } : {}) };
}

export function parseLocations(
  raw: Record<string, unknown>, issues: string[],
): { locations: TenantLocation[]; legacyLocation: boolean } {
  const hasLegacy = raw.location !== undefined;
  const hasList = raw.locations !== undefined;
  if (hasLegacy && hasList) issues.push('use locations or legacy location, not both');
  const values = hasList ? raw.locations : hasLegacy ? [raw.location] : [];
  if (!Array.isArray(values)) {
    issues.push('locations must be a list');
    return { locations: [], legacyLocation: false };
  }
  if (values.length > 100) issues.push('locations may contain at most 100 entries');
  const locations = values.flatMap((value, index) => {
    const location = parseLocation(value, index, issues);
    return location ? [location] : [];
  });
  const names = locations.map((location) => location.name.toLocaleLowerCase());
  if (new Set(names).size !== names.length) issues.push('locations must have unique names');
  return { locations, legacyLocation: hasLegacy };
}
