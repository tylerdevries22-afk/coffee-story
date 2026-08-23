import { currentBusiness } from '@/data/business';

import type {
  AdminSetupAnswers,
  AppRole,
  ClientSetupAnswers,
  PortalBundle,
  PortalSetupState,
  RoleSetup,
  SetupStatus,
  StaffSetupAnswers,
} from '@/types/domain';

/**
 * Pure setup/onboarding logic for the demo portal — the native counterpart of
 * the web portal's setup flow. Progress lives on the persisted PortalBundle
 * (`portal.setup`), so it survives restarts through demo-storage like every
 * other demo mutation. Stored blobs are user-editable files: everything read
 * back is sanitized before the UI dereferences it.
 */

export const SETUP_STEP_COUNT = 3;
export const SETUP_AUTO_PROMPT_DELAY_MS = 3_000;

export function shouldScheduleSetupAutoPrompt({
  isDemo,
  isHydrating,
  dismissed,
  promptOpen,
}: {
  isDemo: boolean;
  isHydrating: boolean;
  dismissed: boolean;
  promptOpen: boolean;
}): boolean {
  return isDemo && !isHydrating && !dismissed && !promptOpen;
}

export function setupProgressPercent(setup: RoleSetup<unknown>): number {
  if (setup.status === 'completed') return 100;
  if (setup.status === 'not_started') return 0;
  return Math.round(((Math.min(setup.step, SETUP_STEP_COUNT - 1) + 1) / SETUP_STEP_COUNT) * 100);
}

export const CLIENT_GOAL_OPTIONS = [
  'A reliable morning coffee',
  'Somewhere to work or study',
  'Trying the signature drinks',
  'Late-night hours',
  'Halal-friendly food',
  'Catering for events',
] as const;

/**
 * How strong a guest takes their coffee. The field name and wire values are
 * the portal API's (`pressurePreference: light|medium|firm`); every label a
 * person reads comes from `strengthLabel`.
 */
export const PRESSURE_OPTIONS = ['light', 'medium', 'firm'] as const;

export function strengthLabel(value: string): string {
  switch (value) {
    case 'light': return 'Light';
    case 'medium': return 'Medium';
    case 'firm': return 'Bold';
    default: return value;
  }
}

export const PREFERRED_TIME_OPTIONS = [
  'Weekday mornings',
  'Weekday afternoons',
  'Weekday evenings',
  'Saturday',
] as const;

export const STAFF_SPECIALTY_OPTIONS = [
  'Espresso bar',
  'Latte art',
  'Matcha & tea',
  'Boba',
  'Pastry & bakes',
  'Coffee cart catering',
] as const;

export const DAY_OPTIONS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const INITIAL_CLIENT: RoleSetup<ClientSetupAnswers> = {
  status: 'not_started',
  step: 0,
  answers: { goals: [], pressure: 'medium', preferredTimes: [] },
};

const INITIAL_STAFF: RoleSetup<StaffSetupAnswers> = {
  status: 'not_started',
  step: 0,
  answers: { specialties: [], workingDays: [] },
};

const INITIAL_ADMIN: RoleSetup<AdminSetupAnswers> = {
  status: 'not_started',
  step: 0,
  answers: {
    businessName: currentBusiness().name,
    openDays: [],
    servicesConfirmed: false,
    teamConfirmed: false,
    onlineBooking: true,
  },
};

export function initialSetupState(): PortalSetupState {
  return {
    client: clone(INITIAL_CLIENT),
    staff: clone(INITIAL_STAFF),
    admin: clone(INITIAL_ADMIN),
  };
}

function safeStatus(value: unknown): SetupStatus {
  return value === 'in_progress' || value === 'completed' ? value : 'not_started';
}

function safeStep(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.min(Math.max(Math.trunc(value), 0), SETUP_STEP_COUNT - 1);
}

function safeStrings(value: unknown, allowed: readonly string[]): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && allowed.includes(item));
}

function safeRole<Answers>(
  value: unknown,
  fallback: RoleSetup<Answers>,
  sanitizeAnswers: (answers: unknown) => Answers,
): RoleSetup<Answers> {
  if (!value || typeof value !== 'object') return clone(fallback);
  const candidate = value as Partial<RoleSetup<unknown>>;
  return {
    status: safeStatus(candidate.status),
    step: safeStep(candidate.step),
    answers: sanitizeAnswers(candidate.answers),
  };
}

/** The portal's setup state, sanitized and with defaults filled. */
export function portalSetup(portal: PortalBundle): PortalSetupState {
  const stored = portal.setup;
  return {
    client: safeRole(stored?.client, INITIAL_CLIENT, (answers) => {
      const candidate = (answers ?? {}) as Partial<ClientSetupAnswers>;
      return {
        goals: safeStrings(candidate.goals, CLIENT_GOAL_OPTIONS),
        pressure: PRESSURE_OPTIONS.includes(candidate.pressure as never)
          ? (candidate.pressure as ClientSetupAnswers['pressure'])
          : 'medium',
        preferredTimes: safeStrings(candidate.preferredTimes, PREFERRED_TIME_OPTIONS),
      };
    }),
    staff: safeRole(stored?.staff, INITIAL_STAFF, (answers) => {
      const candidate = (answers ?? {}) as Partial<StaffSetupAnswers>;
      return {
        specialties: safeStrings(candidate.specialties, STAFF_SPECIALTY_OPTIONS),
        workingDays: safeStrings(candidate.workingDays, DAY_OPTIONS),
      };
    }),
    admin: safeRole(stored?.admin, INITIAL_ADMIN, (answers) => {
      const candidate = (answers ?? {}) as Partial<AdminSetupAnswers>;
      return {
        businessName: typeof candidate.businessName === 'string'
          ? candidate.businessName.slice(0, 120)
          : INITIAL_ADMIN.answers.businessName,
        openDays: safeStrings(candidate.openDays, DAY_OPTIONS),
        servicesConfirmed: candidate.servicesConfirmed === true,
        teamConfirmed: candidate.teamConfirmed === true,
        onlineBooking: candidate.onlineBooking !== false,
      };
    }),
  };
}

export type AnyRoleSetup =
  | RoleSetup<ClientSetupAnswers>
  | RoleSetup<StaffSetupAnswers>
  | RoleSetup<AdminSetupAnswers>;

/**
 * Persist one role's setup onto the bundle. Completing the client wizard also
 * writes the pressure preference into the intake profile, the same way the web
 * wizard feeds the portal profile.
 */
export function withRoleSetup(
  portal: PortalBundle,
  role: AppRole,
  setup: AnyRoleSetup,
): PortalBundle {
  const next: PortalBundle = {
    ...portal,
    setup: { ...portalSetup(portal), [role]: setup },
  };
  if (role === 'client' && setup.status === 'completed' && portal.intake) {
    next.intake = {
      ...portal.intake,
      pressurePreference: (setup as RoleSetup<ClientSetupAnswers>).answers.pressure,
    };
  }
  return next;
}

/** Facts for the "already set up" review card. */
export function setupSummary(role: AppRole, setup: PortalSetupState): { label: string; value: string }[] {
  if (role === 'client') {
    const { answers } = setup.client;
    return [
      { label: 'Goals', value: answers.goals.length ? answers.goals.slice(0, 2).join(', ') : '—' },
      { label: 'Strength', value: strengthLabel(answers.pressure) },
      { label: 'Best times', value: answers.preferredTimes.length ? answers.preferredTimes.slice(0, 2).join(', ') : 'Flexible' },
    ];
  }
  if (role === 'staff') {
    const { answers } = setup.staff;
    return [
      { label: 'Specialties', value: answers.specialties.length ? answers.specialties.slice(0, 2).join(', ') : '—' },
      { label: 'Days available', value: answers.workingDays.length ? `${answers.workingDays.length} of 7` : '—' },
    ];
  }
  const { answers } = setup.admin;
  return [
    { label: 'Studio', value: answers.businessName || '—' },
    { label: 'Open days', value: answers.openDays.length ? `${answers.openDays.length} of 7` : '—' },
    { label: 'Online booking', value: answers.onlineBooking ? 'On' : 'Off' },
  ];
}

export function toggleListItem(list: string[], item: string): string[] {
  return list.includes(item) ? list.filter((entry) => entry !== item) : [...list, item];
}
