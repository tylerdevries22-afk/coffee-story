import type { StaffSettings } from '@/types/domain';

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
  onlineBookingEnabled: true,
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
  businessName: 'Coffee Story',
  businessEmail: 'hello@coffeestoryhealingoasis.com',
  businessPhone: '(720) 810-0336',
  businessAddress: '5650 Greenwood Plaza Blvd, Suite 225-C · Greenwood Village, CO 80111',
};

export function validateAdminSettings(settings: AdminSettingsState): string | null {
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
  if (!settings.businessName.trim()) return 'Business name is required.';
  if (!settings.businessEmail.includes('@')) return 'Enter a valid business email.';
  return null;
}

export function serverStaffSettings(settings: AdminSettingsState): StaffSettings {
  return {
    availability: settings.availability,
    onlineBookingEnabled: settings.onlineBookingEnabled,
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
