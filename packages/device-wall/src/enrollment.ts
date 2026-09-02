import {
  DEVICE_APP_TARGETS, DEVICE_CAPABILITIES, DEVICE_FORM_FACTORS, DEVICE_PLATFORMS,
  type DeviceAppTarget, type DeviceCapability, type DeviceFormFactor, type DevicePlatform,
} from './types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VERSION = /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,31}$/;

export class DeviceEnrollmentError extends Error {
  constructor(readonly field: string, message: string) {
    super(message);
    this.name = 'DeviceEnrollmentError';
  }
}

export type DeviceRegistrationInput = {
  readonly installationId: string;
  readonly locationId: string;
  readonly label: string;
  readonly formFactor: DeviceFormFactor;
  readonly appTarget: DeviceAppTarget;
  readonly platform: DevicePlatform;
  readonly appVersion: string;
  readonly runtimeVersion: string;
  readonly capabilities: readonly DeviceCapability[];
  readonly publicKey: string | null;
};

export type DeviceEnrollmentRequest = {
  readonly brandId: string | null;
  readonly locationId: string;
  readonly label: string;
  readonly formFactor: DeviceFormFactor;
  readonly appTarget: DeviceAppTarget;
};

function choice<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new DeviceEnrollmentError(field, `${field} is not supported.`);
  }
  return value as T;
}

function version(value: unknown, field: string): string {
  if (typeof value !== 'string' || !VERSION.test(value)) {
    throw new DeviceEnrollmentError(field, `${field} is invalid.`);
  }
  return value;
}

export function normalizeDeviceLabel(value: unknown): string {
  if (typeof value !== 'string') throw new DeviceEnrollmentError('label', 'label is required.');
  const label = value.trim().replace(/\s+/g, ' ');
  if (label.length < 1 || label.length > 60) {
    throw new DeviceEnrollmentError('label', 'label must be 1-60 characters.');
  }
  return label;
}

export function parseDeviceEnrollment(value: unknown): DeviceEnrollmentRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new DeviceEnrollmentError('body', 'Enrollment must be an object.');
  }
  const input = value as Record<string, unknown>;
  const brandId = input.brandId === undefined || input.brandId === null ? null : input.brandId;
  if (brandId !== null && (typeof brandId !== 'string' || !UUID.test(brandId))) {
    throw new DeviceEnrollmentError('brandId', 'brandId must be a UUID.');
  }
  if (typeof input.locationId !== 'string' || !UUID.test(input.locationId)) {
    throw new DeviceEnrollmentError('locationId', 'locationId must be a UUID.');
  }
  return {
    brandId: brandId ? brandId.toLowerCase() : null,
    locationId: input.locationId.toLowerCase(),
    label: normalizeDeviceLabel(input.label),
    formFactor: choice(input.formFactor, DEVICE_FORM_FACTORS, 'formFactor'),
    appTarget: choice(input.appTarget, DEVICE_APP_TARGETS, 'appTarget'),
  };
}

export function parseDeviceRegistration(value: unknown): DeviceRegistrationInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new DeviceEnrollmentError('body', 'Registration must be an object.');
  }
  const input = value as Record<string, unknown>;
  if (typeof input.installationId !== 'string' || !UUID.test(input.installationId)) {
    throw new DeviceEnrollmentError('installationId', 'installationId must be a UUID.');
  }
  if (typeof input.locationId !== 'string' || !UUID.test(input.locationId)) {
    throw new DeviceEnrollmentError('locationId', 'locationId must be a UUID.');
  }
  if (!Array.isArray(input.capabilities) || input.capabilities.some((item) => !DEVICE_CAPABILITIES.includes(item as DeviceCapability))) {
    throw new DeviceEnrollmentError('capabilities', 'capabilities contain an unsupported value.');
  }
  const publicKey = input.publicKey === null || input.publicKey === undefined ? null : input.publicKey;
  if (publicKey !== null && (typeof publicKey !== 'string' || publicKey.length < 32 || publicKey.length > 4096)) {
    throw new DeviceEnrollmentError('publicKey', 'publicKey is invalid.');
  }
  return {
    installationId: input.installationId.toLowerCase(),
    locationId: input.locationId.toLowerCase(),
    label: normalizeDeviceLabel(input.label),
    formFactor: choice(input.formFactor, DEVICE_FORM_FACTORS, 'formFactor'),
    appTarget: choice(input.appTarget, DEVICE_APP_TARGETS, 'appTarget'),
    platform: choice(input.platform, DEVICE_PLATFORMS, 'platform'),
    appVersion: version(input.appVersion, 'appVersion'),
    runtimeVersion: version(input.runtimeVersion, 'runtimeVersion'),
    capabilities: [...new Set(input.capabilities as DeviceCapability[])],
    publicKey,
  };
}

export function pairedDeviceRole(target: DeviceAppTarget): 'prep' | 'display' | 'kiosk' {
  if (target === 'operator') return 'prep';
  return target === 'pickup_queue' ? 'display' : 'kiosk';
}
