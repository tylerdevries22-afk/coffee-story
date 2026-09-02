import type { DeviceWallLayoutItem } from './types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class DeviceWallLayoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeviceWallLayoutError';
  }
}

function coordinate(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < -10_000 || value > 10_000) {
    throw new DeviceWallLayoutError('Layout coordinates must be finite and bounded.');
  }
  return Math.round(value * 100) / 100;
}

export function parseDeviceWallLayout(value: unknown): readonly DeviceWallLayoutItem[] {
  if (!Array.isArray(value) || value.length > 100) {
    throw new DeviceWallLayoutError('A layout must contain at most 100 devices.');
  }
  const seen = new Set<string>();
  return value.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new DeviceWallLayoutError('Every layout entry must be an object.');
    }
    const item = entry as Record<string, unknown>;
    if (typeof item.installationId !== 'string' || !UUID.test(item.installationId) || seen.has(item.installationId)) {
      throw new DeviceWallLayoutError('Every layout installation must be a unique UUID.');
    }
    if (item.orientation !== 'portrait' && item.orientation !== 'landscape') {
      throw new DeviceWallLayoutError('Layout orientation must be portrait or landscape.');
    }
    const width = coordinate(item.width);
    if (width < 120 || width > 640) throw new DeviceWallLayoutError('Layout width must be from 120 to 640.');
    seen.add(item.installationId);
    return {
      installationId: item.installationId.toLowerCase(), x: coordinate(item.x), y: coordinate(item.y),
      width, orientation: item.orientation,
    };
  });
}
