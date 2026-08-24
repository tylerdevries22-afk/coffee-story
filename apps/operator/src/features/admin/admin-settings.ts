import { BUSINESS, BUSINESS_ADDRESS } from '@/data/business';

import type { StaffSettings } from '@platform/domain';

export type AdminSettingsTab = 'Availability' | 'Booking Rules' | 'Payments' | 'Messages' | 'Forms' | 'Business Info';

export type AdminSettingsState = StaffSettings & {
  confirmationsEnabled: boolean;
  remindersEnabled: boolean;
  intakeRequired: boolean;
  consentRequired: boolean;
  businessName: string;
  businessEmail: string;
  businessPhone: string;
  businessAddress: string;
};

export const ADMIN_SETTINGS_TABS: readonly AdminSettingsTab[] = [
  'Availability',
  'Booking Rules',
  'Payments',
  'Messages',
  'Forms',
  'Business Info',
] as const;

const LIVE_WRITABLE_TABS: ReadonlySet<AdminSettingsTab> = new Set([
  'Availability',
  'Booking Rules',
  'Payments',
  'Messages',
]);

const DEMO_ONLY_FIELDS: ReadonlySet<keyof AdminSettingsState> = new Set([
  'confirmationsEnabled',
  'remindersEnabled',
  'intakeRequired',
  'consentRequired',
  'businessName',
  'businessEmail',
  'businessPhone',
  'businessAddress',
]);

export function isAdminSettingsTabWritableInLive(tab: AdminSettingsTab): boolean {
  return LIVE_WRITABLE_TABS.has(tab);
}

export function isAdminSettingWritableInLive(field: keyof AdminSettingsState): boolean {
  return !DEMO_ONLY_FIELDS.has(field);
}

export const DEFAULT_ADMIN_SETTINGS: AdminSettingsState = {
  availability: [
    { weekday: 0, label: 'Sunday', enabled: false, startMin: 600, endMin: 960 },
    { weekday: 1, label: 'Monday', enabled: true, startMin: 600, endMin: 1050 },
    { weekday: 2, label: 'Tuesday', enabled: true, startMin: 600, endMin: 1050 },
    { weekday: 3, label: 'Wednesday', enabled: true, startMin: 600, endMin: 900 },
    { weekday: 4, label: 'Thursday', enabled: true, startMin: 600, endMin: 1050 },
    { weekday: 5, label: 'Friday', enabled: true, startMin: 600, endMin: 1050 },
    { weekday: 6, label: 'Saturday', enabled: true, startMin: 600, endMin: 960 },
  ],
  onlineOrderingEnabled: true,
  requireAccountToBook: false,
  waitlistEnabled: true,
  leadTimeMinutes: 120,
  cancellationHours: 24,
  requireDeposit: true,
  promptForTip: true,
  storeCardOnFile: false,
  reviewRequestEnabled: true,
  confirmationsEnabled: true,
  remindersEnabled: true,
  intakeRequired: true,
  consentRequired: true,
  businessName: BUSINESS.name,
  businessEmail: BUSINESS.email,
  businessPhone: BUSINESS.phone,
  businessAddress: BUSINESS_ADDRESS,
};

export function validateAdminSettings(settings: AdminSettingsState, isLive = false): string | null {
  if (!Number.isInteger(settings.leadTimeMinutes) || settings.leadTimeMinutes < 0 || settings.leadTimeMinutes > 10080) {
    return 'Lead time must be between 0 and 10,080 minutes.';
  }
  if (!Number.isInteger(settings.cancellationHours) || settings.cancellationHours < 0 || settings.cancellationHours > 720) {
    return 'Cancellation window must be between 0 and 720 hours.';
  }
  const invalidAvailability = settings.availability.some((day) => (
    day.enabled && (day.startMin < 0 || day.endMin > 1440 || day.endMin <= day.startMin)
  ));
  if (settings.availability.length !== 7 || invalidAvailability) {
    return 'Review the seven availability windows.';
  }
  // Business Info is the brand's own identity. In live mode it is read from
  // the brand row and not editable here, so it must not be something the
  // operator is asked to fix before they can save an availability change --
  // a brand that posted no mailbox would otherwise be locked out of Settings
  // entirely, on a tab with no email field on it.
  if (isLive) return null;
  if (!settings.businessName.trim()) return 'Business name is required.';
  if (!settings.businessEmail.includes('@')) return 'Enter a valid business email.';
  return null;
}

export function serverStaffSettings(settings: AdminSettingsState): StaffSettings {
  return {
    availability: settings.availability,
    onlineOrderingEnabled: settings.onlineOrderingEnabled,
    requireAccountToBook: settings.requireAccountToBook,
    waitlistEnabled: settings.waitlistEnabled,
    leadTimeMinutes: settings.leadTimeMinutes,
    cancellationHours: settings.cancellationHours,
    requireDeposit: settings.requireDeposit,
    promptForTip: settings.promptForTip,
    storeCardOnFile: settings.storeCardOnFile,
    reviewRequestEnabled: settings.reviewRequestEnabled,
  };
}

export function mergeServerStaffSettings(
  current: AdminSettingsState,
  settings: StaffSettings,
): AdminSettingsState {
  return { ...current, ...settings };
}

/**
 * The Business Info fields are the brand's identity, not settings the server
 * stores — in live mode they belong to the signed-in brand row, not to the
 * bundled defaults, which are Coffee Story's because demo mode is.
 */
export function withBusinessIdentity(
  current: AdminSettingsState,
  business: { name: string; email: string; phone: string; street: string; cityLine: string },
): AdminSettingsState {
  return {
    ...current,
    businessName: business.name,
    businessEmail: business.email,
    businessPhone: business.phone,
    businessAddress: [business.street, business.cityLine].filter(Boolean).join(', '),
  };
}
